import {
  DEFAULT_BATTLE_SCHEDULER_MODE,
} from "../combat/battle";
import { getItem } from "../content";
import {
  isPlayer,
  createPlayerCharacter,
  type PlayerCharacter,
} from "../entity/actor";
import { restoreRng, createRng } from "../infra/rng";
import {
  createEmptyState,
  type GameState,
} from "../infra/state";
import {
  createInventory,
  DEFAULT_CHAR_INVENTORY_CAPACITY,
} from "../inventory";
import { SAVE_VERSION } from "../save/migrations";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_DUNGEON_KIND,
  ACTIVITY_GATHER_KIND,
  createCombatActivity,
  createDungeonActivity,
  createGatherActivity,
} from "../world/activity";
import { enterStage as enterStageCore } from "../world/stage";
import { assertRuntimeIdState } from "../runtime-ids";
import {
  addItemToInventory,
  tearDownCharInstance,
} from "./runtime";
import type {
  CharacterControllerImpl,
  CombatActivityData,
  DungeonActivityData,
  GatherActivityData,
  SessionRuntime,
} from "./types";

interface SessionLifecycleDeps {
  runtime: SessionRuntime;
  createCharacterController(hero: PlayerCharacter): CharacterControllerImpl;
  restoreDungeonParty(dungeonSessionId: string, state?: GameState): void;
  unlock(unlockId: string, source?: string): boolean;
  /** Re-evaluate quest state objectives and autoAccept after load/reset. */
  questReeval(): void;
}

export interface SessionLifecycle {
  loadFromSave(loaded: GameState): void;
  resetToFresh(): void;
}

/** Save/load/reset lifecycle for GameSession runtime objects. */
export function createSessionLifecycle(
  deps: SessionLifecycleDeps,
): SessionLifecycle {
  const {
    runtime,
    createCharacterController,
    restoreDungeonParty,
    unlock,
    questReeval,
  } = deps;

  function rehydrateAll(): void {
    for (const cc of runtime.characters.values()) {
      if (cc._activity) runtime.engine.unregister(cc._activity.id);
    }
    for (const ctrl of runtime.stageControllers.values()) {
      runtime.engine.unregister(ctrl.id);
    }
    for (const dungeonActivity of runtime.dungeonActivities.values()) {
      runtime.engine.unregister(dungeonActivity.id);
    }
    runtime.characters.clear();
    runtime.stageControllers.clear();
    runtime.dungeonActivities.clear();
    runtime.combatActivities.clear();
    assertRuntimeIdState(runtime.state);

    for (const actor of runtime.state.actors) {
      if (!isPlayer(actor)) continue;
      const hero = actor as PlayerCharacter;
      const cc = createCharacterController(hero);
      runtime.characters.set(hero.id, cc);
    }

    for (const [stageId, session] of Object.entries(runtime.state.stages)) {
      const ctrl = enterStageCore({
        stageId,
        locationId: session.locationId,
        mode: session.mode,
        ctxProvider: runtime.buildCtx,
        resume: true,
      });
      runtime.stageControllers.set(stageId, ctrl);
      runtime.engine.register(ctrl);
    }

    for (const [dungeonSessionId, dungeonSession] of Object.entries(runtime.state.dungeons)) {
      if (dungeonSession.status !== "in_progress") continue;

      const partyLeader = dungeonSession.partyCharIds
        .map((charId) => runtime.state.actors.find((actor) => actor.id === charId))
        .find((actor): actor is PlayerCharacter => !!actor && isPlayer(actor));
      const heroActivity =
        partyLeader?.activity?.kind === ACTIVITY_DUNGEON_KIND
          ? (partyLeader.activity.data as DungeonActivityData)
          : null;

      const dungeonActivity = createDungeonActivity({
        dungeonSessionId,
        ctxProvider: runtime.buildCtx,
        restoreParty: () =>
          restoreDungeonParty(dungeonSessionId, runtime.state),
        resume: {
          phase: heroActivity?.phase ?? dungeonSession.phase,
          currentBattleId: heroActivity?.currentBattleId ?? null,
          transitionTick:
            heroActivity?.transitionTick ?? dungeonSession.transitionTick,
        },
      });
      runtime.dungeonActivities.set(dungeonSessionId, dungeonActivity);
      runtime.engine.register(dungeonActivity);
    }

    const rehydratedCombatStages = new Set<string>();
    for (const cc of runtime.characters.values()) {
      const hero = cc.hero;
      if (!hero.activity) continue;
      if (hero.activity.kind === ACTIVITY_COMBAT_KIND) {
        const data = hero.activity.data as CombatActivityData;
        if (rehydratedCombatStages.has(data.stageId)) {
          const existing = runtime.combatActivities.get(data.stageId);
          if (existing) cc._activity = existing;
          continue;
        }
        rehydratedCombatStages.add(data.stageId);
        const combatActivity = createCombatActivity({
          stageId: data.stageId,
          partyCharIds: data.partyCharIds ?? [hero.id],
          ctxProvider: runtime.buildCtx,
          resume: {
            phase: data.phase,
            currentBattleId: data.currentBattleId,
            lastTransitionTick: data.lastTransitionTick,
          },
        });
        runtime.combatActivities.set(data.stageId, combatActivity);
        cc._activity = combatActivity;
        if (combatActivity.phase !== "stopped") {
          runtime.engine.register(combatActivity);
        }
        continue;
      }

      if (hero.activity.kind === ACTIVITY_GATHER_KIND) {
        const data = hero.activity.data as GatherActivityData;
        cc._activity = createGatherActivity({
          ownerCharacterId: hero.id,
          nodeId: data.nodeId,
          ctxProvider: runtime.buildCtx,
          resume: { progressTicks: data.progressTicks },
        });
        runtime.engine.register(cc._activity);
      }
    }

    for (const combatActivity of runtime.combatActivities.values()) {
      for (const charId of combatActivity.partyCharIds) {
        const cc = runtime.characters.get(charId);
        if (cc && !cc._activity) cc._activity = combatActivity;
      }
    }
  }

  return {
    loadFromSave(loaded) {
      runtime.state = loaded;
      assertRuntimeIdState(runtime.state);
      runtime.rng = restoreRng(loaded.rngState);
      runtime.engine.setTick(loaded.tick);
      rehydrateAll();
      questReeval();
    },

    resetToFresh() {
      for (const cc of runtime.characters.values()) {
        tearDownCharInstance(runtime, cc);
      }
      runtime.characters.clear();
      runtime.stageControllers.clear();
      for (const dungeonActivity of runtime.dungeonActivities.values()) {
        runtime.engine.unregister(dungeonActivity.id);
      }
      runtime.dungeonActivities.clear();
      for (const combatActivity of runtime.combatActivities.values()) {
        runtime.engine.unregister(combatActivity.id);
      }
      runtime.combatActivities.clear();

      runtime.state = createEmptyState(runtime.seed, SAVE_VERSION);
      runtime.rng = createRng(runtime.seed);
      runtime.battleSchedulerMode = DEFAULT_BATTLE_SCHEDULER_MODE;
      runtime.engine.setTick(0);

      const starting = runtime.content.starting;
      if (!starting) {
        throw new Error(
          "session.resetToFresh: content.starting is not configured; set ContentDb.starting before booting a new game",
        );
      }
      if (starting.heroes.length === 0) {
        throw new Error(
          "session.resetToFresh: content.starting.heroes is empty",
        );
      }

      // focusedCharId 必须在英雄创建循环之前设置：自动装备时 equipItem 会触发
      // equipmentChanged 事件，store 收到后立即写存档。若此时 focusedCharId 还是
      // 初始空串，存档就会带着坏数据写进去，导致下次加载时 getCharacter("") 报错。
      runtime.state.focusedCharId = starting.heroes[0]!.id;

      for (const heroCfg of starting.heroes) {
        const hero = createPlayerCharacter({
          id: heroCfg.id,
          name: heroCfg.name,
          heroConfigId: heroCfg.id,
          xpCurve: heroCfg.xpCurve,
          knownTalents: heroCfg.knownTalents.slice(),
          baseAttrs: heroCfg.baseAttrs as Record<string, number> | undefined,
        });
        runtime.state.actors.push(hero);
        if (!runtime.state.inventories[hero.id]) {
          runtime.state.inventories[hero.id] = createInventory(
            heroCfg.inventoryCapacity ?? DEFAULT_CHAR_INVENTORY_CAPACITY,
          );
        }
        if (heroCfg.startingItems?.length) {
          for (const entry of heroCfg.startingItems) {
            addItemToInventory(runtime, hero.id, entry.itemId, entry.qty);
          }
        }
        const cc = createCharacterController(hero);
        runtime.characters.set(hero.id, cc);

        // 自动装备起始 gear：遍历背包，找到可装备且对应 slot 空着的 gear 就直接装上。
        // 使用 equipItem 确保 rebuildCharacterDerived 正确触发，modifier 堆叠不遗漏。
        const inventory = runtime.state.inventories[hero.id]!;
        for (let i = 0; i < inventory.slots.length; i += 1) {
          const slot = inventory.slots[i];
          if (!slot || slot.kind !== "gear") continue;
          const itemDef = getItem(slot.instance.itemId);
          if (!itemDef.slot) continue;
          if (hero.equipped[itemDef.slot]) continue;
          cc.equipItem(i);
          break;
        }

        cc.enterLocation(starting.initialLocationId);
      }

      for (const unlockDef of Object.values(runtime.content.unlocks)) {
        if (!unlockDef.defaultUnlocked) continue;
        unlock(unlockDef.id, "starting.default");
      }

      questReeval();
    },
  };
}
