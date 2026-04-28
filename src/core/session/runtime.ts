import {
  DEFAULT_BATTLE_SCHEDULER_MODE,
} from "../combat/battle";
import { type ItemId, getItem } from "../content";
import {
  createPlayerCharacter,
  isCharacter,
  isPlayer,
  isResourceNode,
  rebuildCharacterDerived,
  type PlayerCharacter,
} from "../entity/actor";
import { createGameEventBus } from "../infra/events";
import { attachGameLogCollector } from "../infra/game-log";
import { createRng } from "../infra/rng";
import {
  SHARED_INVENTORY_KEY,
  createEmptyState,
} from "../infra/state";
import { createTickEngine } from "../infra/tick";
import {
  addGear,
  addStack,
  removeAtSlot,
  type Inventory,
} from "../inventory";
import { getInventoryStackLimit } from "../inventory/stack-limit";
import { createGearInstance } from "../item";
import { SAVE_VERSION } from "../save/migrations";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  type CombatActivity,
  type GatherActivity,
} from "../world/activity";
import {
  OUT_OF_COMBAT_RECOVERY_EFFECT_ID,
  applyActorOutOfCombatRecovery,
  ensureRecoveryEffect,
  removePhaseRecoveryEffect,
} from "../world/activity/recovery";
import {
  enterStage as enterStageCore,
  leaveStage as leaveStageCore,
} from "../world/stage";
import { mintStageId } from "../runtime-ids";
import type { CreateGameSessionOptions, CharacterControllerImpl, SessionRuntime, StageTeardownReason, StartStageInstanceOptions } from "./types";

const OUT_OF_COMBAT_RECOVERY_SOURCE_PREFIX =
  "activity.phase_recovery:session.out_of_combat:";

/**
 * Session runtime owns all mutable live objects.
 *
 * It is the only place that knows about engine, bus, RNG, stage/activity maps,
 * and runtime-only helpers such as stage teardown / re-entry.
 */
export function createSessionRuntime(
  opts: CreateGameSessionOptions,
): SessionRuntime {
  const seed = opts.seed ?? 42;
  const bus = createGameEventBus();
  const engine = createTickEngine({ initialSpeedMultiplier: 1 });

  const runtime: SessionRuntime = {
    content: opts.content,
    seed,
    state: createEmptyState(seed, SAVE_VERSION),
    rng: createRng(seed),
    battleSchedulerMode: DEFAULT_BATTLE_SCHEDULER_MODE,
    bus,
    engine,
    characters: new Map(),
    stageControllers: new Map(),
    dungeonActivities: new Map(),
    combatActivities: new Map(),
    stopLoop: () => {},
    disposeGameLogCollector: () => {},
    buildCtx() {
      return {
        state: runtime.state,
        bus,
        rng: runtime.rng,
        currentTick: engine.currentTick,
        battleSchedulerMode: runtime.battleSchedulerMode,
      };
    },
  };

  runtime.stopLoop = engine.start();
  runtime.disposeGameLogCollector = attachGameLogCollector({
    bus,
    getState: () => runtime.state,
    getCurrentTick: () => engine.currentTick,
  });

  bus.on("activityComplete", (payload) => {
    if (payload.kind === ACTIVITY_COMBAT_KIND && payload.charId) {
      for (const [stageId, combatActivity] of runtime.combatActivities) {
        if (!combatActivity.partyCharIds.includes(payload.charId)) continue;
        engine.unregister(combatActivity.id);
        runtime.combatActivities.delete(stageId);
        for (const charId of combatActivity.partyCharIds) {
          const cc = runtime.characters.get(charId);
          if (cc) cc._activity = null;
        }
        break;
      }
      return;
    }

    if (!payload.charId) return;
    const cc = runtime.characters.get(payload.charId);
    if (cc) cc._activity = null;
  });

  engine.register({
    id: "session:out_of_combat_recovery",
    tick() {
      applyOutOfCombatRecoveryTick(runtime);
    },
  });

  return runtime;
}

function applyOutOfCombatRecoveryTick(runtime: SessionRuntime): void {
  const ongoingBattleParticipants = new Set<string>();
  for (const battle of runtime.state.battles) {
    if (battle.outcome !== "ongoing") continue;
    for (const actorId of battle.participantIds) {
      ongoingBattleParticipants.add(actorId);
    }
  }

  const ctx = runtime.buildCtx();
  for (const actor of runtime.state.actors) {
    if (!isCharacter(actor) || !isPlayer(actor)) continue;
    const sourceId = outOfCombatRecoverySourceId(actor.id);
    const inBattle = ongoingBattleParticipants.has(actor.id);
    const inCombatActivity = actor.activity?.kind === ACTIVITY_COMBAT_KIND;
    if (inBattle || inCombatActivity || actor.currentHp <= 0) {
      removePhaseRecoveryEffect(actor, sourceId);
      continue;
    }
    ensureRecoveryEffect(
      actor,
      ctx,
      sourceId,
      OUT_OF_COMBAT_RECOVERY_EFFECT_ID,
    );
    applyActorOutOfCombatRecovery(actor, ctx);
  }
}

function outOfCombatRecoverySourceId(actorId: string): string {
  return `${OUT_OF_COMBAT_RECOVERY_SOURCE_PREFIX}${actorId}`;
}

export function getInventoryByOwner(
  runtime: SessionRuntime,
  inventoryOwnerId: string,
): Inventory {
  const inventory = runtime.state.inventories[inventoryOwnerId];
  if (!inventory) {
    throw new Error(
      `session: no inventory found for owner "${inventoryOwnerId}"`,
    );
  }
  return inventory;
}

export function addItemToInventory(
  runtime: SessionRuntime,
  inventoryOwnerId: string,
  itemId: ItemId | string,
  qty: number,
): void {
  const inventory = getInventoryByOwner(runtime, inventoryOwnerId);
  const def = getItem(itemId);
  if (def.stackable) {
    const result = addStack(
      inventory,
      itemId,
      qty,
      getInventoryStackLimit(runtime.state, inventoryOwnerId),
    );
    if (!result.ok) {
      throw new Error(
        `session.addItemToInventory: inventory full for "${inventoryOwnerId}", cannot add stack "${itemId}" (remaining=${result.remaining})`,
      );
    }
    return;
  }

  for (let i = 0; i < qty; i += 1) {
    const result = addGear(
      inventory,
      createGearInstance(itemId, { rng: runtime.rng }),
    );
    if (!result.ok) {
      throw new Error(
        `session.addItemToInventory: inventory full for "${inventoryOwnerId}", cannot add gear "${itemId}"`,
      );
    }
  }
}

export function getSkillLevel(hero: PlayerCharacter, skillId: string): number {
  const key = skillId as keyof PlayerCharacter["skills"];
  return hero.skills[key]?.level ?? 1;
}

export function rebuildHeroDerived(
  runtime: SessionRuntime,
  hero: PlayerCharacter,
): void {
  rebuildCharacterDerived(hero, runtime.state.worldRecord);
}

export function getHeroControllerOrThrow(
  runtime: SessionRuntime,
  charId: string,
): CharacterControllerImpl {
  const cc = runtime.characters.get(charId);
  if (!cc) {
    throw new Error(`session: no hero with id "${charId}"`);
  }
  return cc;
}

function pendingLootEntrySummary(
  entry: NonNullable<CharacterControllerImpl["stageSession"]>["pendingLoot"][number],
) {

  if (entry.kind === "stack") {
    return { itemId: entry.itemId, qty: entry.qty };
  }
  return { itemId: entry.instance.itemId, qty: 1 };
}

function emitPendingLootLost(
  runtime: SessionRuntime,
  charId: string,
  stageId: string,
): void {
  const session = runtime.state.stages[stageId];
  if (!session || session.pendingLoot.length === 0) return;
  runtime.bus.emit("pendingLootLost", {
    charId,
    stageId,
    entries: session.pendingLoot.map((entry) => pendingLootEntrySummary(entry)),
  });
}

function hasOtherStageParticipant(
  runtime: SessionRuntime,
  stageId: string,
  excludeCharId: string,
): boolean {
  for (const [id, cc] of runtime.characters) {
    if (id !== excludeCharId && cc.hero.stageId === stageId) return true;
  }
  return false;
}

/** Tear down a character's current stage + activity. */
export function tearDownCharInstance(
  runtime: SessionRuntime,
  cc: CharacterControllerImpl,
  reason: StageTeardownReason = "system",
): void {
  if (cc._activity) {
    if (cc._activity.kind === ACTIVITY_COMBAT_KIND) {
      const combatActivity = cc._activity as CombatActivity;
      emitPendingLootLost(runtime, cc.hero.id, combatActivity.stageId);
      runtime.bus.emit("activityStopped", {
        charId: cc.hero.id,
        kind: "combat",
        reason,
        stageId: combatActivity.stageId,
      });
      combatActivity.phase = "stopped";
      runtime.engine.unregister(combatActivity.id);
      runtime.combatActivities.delete(combatActivity.stageId);
      for (const charId of combatActivity.partyCharIds) {
        const otherCc = runtime.characters.get(charId);
        if (!otherCc) continue;
        otherCc._activity = null;
        otherCc.hero.activity = null;
        if (otherCc.hero.stageId === combatActivity.stageId) {
          otherCc.hero.stageId = null;
        }
      }
      const ctrl = runtime.stageControllers.get(combatActivity.stageId);
      if (ctrl) {
        runtime.engine.unregister(ctrl.id);
        runtime.stageControllers.delete(combatActivity.stageId);
      }
      leaveStageCore(combatActivity.stageId, runtime.buildCtx());
      return;
    }

    if (cc._activity.kind === ACTIVITY_GATHER_KIND) {
      const stageId = cc.hero.stageId;
      if (stageId) {
        emitPendingLootLost(runtime, cc.hero.id, stageId);
      }
      runtime.bus.emit("activityStopped", {
        charId: cc.hero.id,
        kind: "gather",
        reason,
        stageId: stageId ?? undefined,
      });
      (cc._activity as GatherActivity).stopRequested = true;
      runtime.engine.unregister(cc._activity.id);
      cc._activity = null;
      cc.hero.activity = null;
    }
  }

  const stageId = cc.hero.stageId;
  if (!stageId) return;

  cc.hero.stageId = null;
  if (hasOtherStageParticipant(runtime, stageId, cc.hero.id)) return;

  const ctrl = runtime.stageControllers.get(stageId);
  if (ctrl) {
    runtime.engine.unregister(ctrl.id);
    runtime.stageControllers.delete(stageId);
  }
  leaveStageCore(stageId, runtime.buildCtx());
}

export function startStageInstance(
  runtime: SessionRuntime,
  cc: CharacterControllerImpl,
  opts: StartStageInstanceOptions,
  teardownReason: StageTeardownReason = "switch_activity",
): string {
  tearDownCharInstance(runtime, cc, teardownReason);
  const stageId = mintStageId(runtime.state);
  const ctrl = enterStageCore({
    stageId,
    locationId: opts.locationId,
    mode: opts.mode,
    resourceNodes: opts.resourceNodes,
    ctxProvider: runtime.buildCtx,
  });
  runtime.stageControllers.set(stageId, ctrl);
  runtime.engine.register(ctrl);
  cc.hero.stageId = stageId;
  return stageId;
}

export function findSpawnedResourceNodeActorId(
  runtime: SessionRuntime,
  stageId: string,
  defId: string,
): string {
  const session = runtime.state.stages[stageId];
  if (!session) {
    throw new Error(
      `session.startGather: no active instance while resolving node "${defId}"`,
    );
  }

  for (const actorId of session.spawnedActorIds) {
    const actor = runtime.state.actors.find((candidate) => candidate.id === actorId);
    if (actor && isResourceNode(actor) && actor.defId === defId) {
      return actor.id;
    }
  }

  throw new Error(
    `session.startGather: spawned instance has no resource node for def "${defId}"`,
  );
}

export { SHARED_INVENTORY_KEY, createPlayerCharacter, createEmptyState, removeAtSlot };
