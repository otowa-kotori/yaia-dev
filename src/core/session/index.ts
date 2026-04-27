// GameSession — runtime orchestrator for the game-core.
//
// Two-layer architecture:
//   GameSession  — global layer: tick engine, bus, rng, state, lifecycle,
//                  speed, character management (getCharacter, listHeroes).
//   CharacterController — per-hero layer: gameplay commands (enterLocation,
//                  startFight, startGather, equipItem, craftRecipe, …).
//                  UI calls getFocusedCharacter() and operates directly
//                  without passing charId.
//
// Stage instances live in state.stages (keyed by stageId). Each hero
// references its stage via hero.stageId. StageControllers are managed
// independently in a Map<stageId, StageController> — they are NOT owned
// by CharacterController, because in the future multiple heroes may share
// a stage (co-op dungeons).
//
// Location / Entry / Instance flow (per character):
//   1. cc.enterLocation(locationId) — set hero.locationId, stop any
//      running activity + stage instance. No actors are spawned yet.
//   2. cc.startFight(combatZoneId) — create a StageSession in state.stages,
//      set hero.stageId, spawn first wave, create CombatActivity.
//   3. cc.startGather(nodeId) — create a StageSession in state.stages,
//      set hero.stageId, spawn resource nodes, create GatherActivity.
//   4. cc.stopActivity / cc.leaveLocation — tear down in reverse.
//
// What it is NOT:
// - Not a React bridge. Revision counter, subscriptions, autosave live in
//   the UI Store adapter (src/ui/store.ts).
// - Not a save adapter. It exposes loadFromSave / resetToFresh as lifecycle
//   hooks; the Store decides when/how to persist.
//
// No Math.random / no setInterval inside gameplay paths — everything flows
// through ctx.rng and the tick engine, per the project invariants.

import { createTickEngine, type TickEngine } from "../infra/tick";
import { createGameEventBus, type GameEventBus } from "../infra/events";
import { attachGameLogCollector } from "../infra/game-log";
import { createRng, restoreRng, type Rng } from "../infra/rng";
import {
  SHARED_INVENTORY_KEY,
  createEmptyState,
  type GameState,
  type DungeonSession,
} from "../infra/state";


import { SAVE_VERSION } from "../save/migrations";
import type { ContentDb, ItemId, RecipeDef } from "../content";
import { getCombatZone, getItem, getLocation, getRecipe, getSkill, getDungeon, setContent } from "../content";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  createCombatActivity,
  createGatherActivity,
  type CombatActivity,
  type CombatActivityPhase,
  type GatherActivity,
  ACTIVITY_DUNGEON_KIND,
  createDungeonActivity,
  abandonDungeon as abandonDungeonCore,
  type DungeonActivity,
  type DungeonPhase,
} from "../world/activity";
import {
  OUT_OF_COMBAT_RECOVERY_EFFECT_ID,
  ensureRecoveryEffect,
  removePhaseRecoveryEffect,
  applyActorOutOfCombatRecovery,
} from "../world/activity/recovery";
import {
  createPlayerCharacter,
  isCharacter,
  isPlayer,
  isResourceNode,
  rebuildCharacterDerived,
  type PlayerCharacter,
} from "../entity/actor";
import { registerBuiltinIntents } from "../combat/intent";
import {
  DEFAULT_BATTLE_SCHEDULER_MODE,
  type BattleSchedulerMode,
} from "../combat/battle";
import {

  addGear,

  addStack,
  createInventory,
  DEFAULT_CHAR_INVENTORY_CAPACITY,
  removeAtSlot,
  type Inventory,
} from "../inventory";
import { getInventoryStackLimit } from "../inventory/stack-limit";
import { createGearInstance, type GearInstance } from "../item";
import { grantCharacterXp, grantSkillXp, xpCostToReach } from "../growth/leveling";
import { purchaseUpgrade as purchaseUpgradeCore } from "../growth/upgrade-manager";
import { allocateTalentPoint, equipTalent as equipTalentCore, unequipTalent as unequipTalentCore } from "../growth/talent";
import {
  enterStage as enterStageCore,
  leaveStage as leaveStageCore,
  type StageController,
} from "../world/stage";

import {
  assertRuntimeIdState,
  mintDungeonSessionId,
  mintStageId,
} from "../runtime-ids";
import type { StageSession } from "../world/stage/types";
import type { StageMode } from "../world/stage/types";

// ---------- Persisted activity pointers ----------
// The resume payload stored in PlayerCharacter.activity.data. Mirrored in
// combat.ts / gather.ts and read here only during rehydrateActivity.

interface CombatActivityData extends Record<string, unknown> {
  stageId: string;
  partyCharIds: string[];
  phase: CombatActivityPhase;
  currentBattleId: string | null;
  lastTransitionTick: number;
}

interface DungeonActivityData extends Record<string, unknown> {
  phase: DungeonPhase;
  currentBattleId: string | null;
  transitionTick: number;
}


interface GatherActivityData extends Record<string, unknown> {
  nodeId: string;
  progressTicks: number;
  swingsCompleted: number;
}

// ---------- Public interfaces ----------

/** Per-hero runtime handle. Exposes gameplay commands scoped to one character.
 *  Obtained via session.getCharacter(id) or session.getFocusedCharacter(). */
export interface CharacterController {
  readonly hero: PlayerCharacter;
  readonly activity: CombatActivity | GatherActivity | null;
  /** Convenience getter: state.stages[hero.stageId] ?? null. */
  readonly stageSession: StageSession | null;

  isRunning(): boolean;
  enterLocation(locationId: string): void;
  leaveLocation(): void;
  /** Start solo combat (convenience wrapper for startPartyCombat with 1 hero). */
  startFight(combatZoneId: string): void;
  startGather(nodeId: string): void;
  stopActivity(): void;
  equipItem(slotIndex: number): void;
  unequipItem(slot: string): void;
  discardInventoryItem(inventoryOwnerId: string, slotIndex: number): void;
  storeItemInShared(slotIndex: number): void;
  takeItemFromShared(slotIndex: number): void;
  craftRecipe(recipeId: string): void;

  /** Try to move a specific pending-loot entry into the hero's inventory.
   *  Returns true if successful, false if inventory is still full. */
  pickUpPendingLoot(index: number): boolean;
  /** Try to move all pending loot into inventory. Returns the count of
   *  entries that could not be picked up (still pending). */
  pickUpAllPendingLoot(): number;
  allocateTalent(talentId: string): void;
  equipTalent(talentId: string): void;
  unequipTalent(talentId: string): void;
}

export interface GameSession {
  readonly state: GameState;
  readonly engine: TickEngine;
  readonly bus: GameEventBus;
  readonly focusedCharId: string;

  // Character management.
  getCharacter(charId: string): CharacterController;
  getFocusedCharacter(): CharacterController;
  setFocusedChar(charId: string): void;
  listHeroes(): PlayerCharacter[];

  /** Start a dungeon run with the given party. All characters must be idle. */
  startDungeon(dungeonId: string, partyCharIds: string[]): void;
  /** Start a party combat session in a combat zone. All characters must be idle. */
  startPartyCombat(combatZoneId: string, partyCharIds: string[]): void;
  /** Abandon the currently active dungeon run for a character. No completion rewards. */
  abandonDungeon(charId: string): void;
  /** Purchase the next level of a global upgrade. */
  purchaseUpgrade(upgradeId: string): void;

  // Global commands.

  setSpeedMultiplier(mul: number): void;
  getSpeedMultiplier(): number;
  /** Debug/dev only: controls which scheduler future new battles will use. */
  setBattleSchedulerMode(mode: BattleSchedulerMode): void;
  getBattleSchedulerMode(): BattleSchedulerMode;
  /** Debug/dev only: grant whole character levels to a hero via the normal XP pipeline. */
  debugGrantHeroLevels(charId: string, levels: number): number;

  /** Debug/dev only: create items directly in a hero inventory. */
  debugGiveItem(charId: string, itemId: string, qty: number): void;

  // Lifecycle hooks. The Store owns persistence; these methods replace the
  // in-memory graph but do not touch any save adapter.
  loadFromSave(loaded: GameState): void;
  resetToFresh(): void;
  dispose(): void;
}

export interface CreateGameSessionOptions {
  content: ContentDb;
  /** Deterministic seed. Default 42. */
  seed?: number;
}

// ---------- Factory ----------

export function createGameSession(
  opts: CreateGameSessionOptions,
): GameSession {
  setContent(opts.content);
  registerBuiltinIntents();

  const content = opts.content;
  const seed = opts.seed ?? 42;

  // --- Mutable runtime slots. Swapped on reload. buildCtx always closes
  //     over the current values through the bindings below.
  let state: GameState = createEmptyState(seed, SAVE_VERSION);
  let rng: Rng = createRng(seed);
  let battleSchedulerMode: BattleSchedulerMode = DEFAULT_BATTLE_SCHEDULER_MODE;
  const bus = createGameEventBus();

  const engine = createTickEngine({ initialSpeedMultiplier: 1 });


  // Per-hero runtime controllers. Rebuilt on resetToFresh / loadFromSave.
  const characters = new Map<string, CharacterControllerImpl>();
  // Per-stage runtime controllers. Independent of characters because a stage
  // may be shared by multiple heroes in the future (co-op).
  const stageControllers = new Map<string, StageController>();

  // The engine runs in real time; Store attaches __ui_notifier on top.
  const stopLoop = engine.start();
  const disposeGameLogCollector = attachGameLogCollector({
    bus,
    getState: () => state,
    getCurrentTick: () => engine.currentTick,
  });

  // Activity self-completion cleanup — route by charId.
  bus.on("activityComplete", (payload) => {
    if (payload.kind === ACTIVITY_COMBAT_KIND && payload.charId) {
      // Combat is now a WorldActivity keyed by stageId; clean up from the map.
      for (const [stageId, ca] of combatActivities) {
        if (ca.partyCharIds.includes(payload.charId)) {
          engine.unregister(ca.id);
          combatActivities.delete(stageId);
          // Clear _activity on all party members' controllers.
          for (const charId of ca.partyCharIds) {
            const cc = characters.get(charId);
            if (cc) cc._activity = null;
          }
          break;
        }
      }
    } else if (payload.charId) {
      const cc = characters.get(payload.charId);
      if (cc) cc._activity = null;
    }
  });

  // Active dungeon world activities, keyed by dungeonSessionId.
  const dungeonActivities = new Map<string, DungeonActivity>();
  // Active combat world activities, keyed by stageId.
  const combatActivities = new Map<string, CombatActivity>();

  // ---------- Context builder ----------

  function buildCtx() {
    return {
      state,
      bus,
      rng,
      currentTick: engine.currentTick,
      battleSchedulerMode,
    };

  }

  const OUT_OF_COMBAT_RECOVERY_SOURCE_PREFIX = "activity.phase_recovery:session.out_of_combat:";

  function outOfCombatRecoverySourceId(actorId: string): string {
    return `${OUT_OF_COMBAT_RECOVERY_SOURCE_PREFIX}${actorId}`;
  }

  function applyOutOfCombatRecoveryTick(): void {
    const ongoingBattleParticipants = new Set<string>();
    for (const battle of state.battles) {
      if (battle.outcome !== "ongoing") continue;
      for (const actorId of battle.participantIds) {
        ongoingBattleParticipants.add(actorId);
      }
    }

    const ctx = buildCtx();
    for (const actor of state.actors) {
      if (!isCharacter(actor) || !isPlayer(actor)) continue;
      const sourceId = outOfCombatRecoverySourceId(actor.id);
      const inBattle = ongoingBattleParticipants.has(actor.id);
      const inCombatActivity =
        actor.activity?.kind === ACTIVITY_COMBAT_KIND;
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

  engine.register({
    id: "session:out_of_combat_recovery",
    tick() {
      applyOutOfCombatRecoveryTick();
    },
  });

  // ---------- Shared helpers ----------

  function getInventoryByOwner(inventoryOwnerId: string): Inventory {
    const inventory = state.inventories[inventoryOwnerId];
    if (!inventory) {
      throw new Error(
        `session: no inventory found for owner "${inventoryOwnerId}"`,
      );
    }
    return inventory;
  }

  function addItemToInventory(
    inventoryOwnerId: string,
    itemId: ItemId | string,
    qty: number,
  ): void {
    const inventory = getInventoryByOwner(inventoryOwnerId);
    const def = getItem(itemId);
    if (def.stackable) {
      const res = addStack(
        inventory,
        itemId,
        qty,
        getInventoryStackLimit(state, inventoryOwnerId),
      );
      if (!res.ok) {
        throw new Error(
          `session.addItemToInventory: inventory full for "${inventoryOwnerId}", cannot add stack "${itemId}" (remaining=${res.remaining})`,
        );
      }
      return;
    }
    for (let i = 0; i < qty; i += 1) {
      const res = addGear(inventory, createGearInstance(itemId, { rng }));
      if (!res.ok) {
        throw new Error(
          `session.addItemToInventory: inventory full for "${inventoryOwnerId}", cannot add gear "${itemId}"`,
        );
      }
    }
  }

  function getSkillLevel(hero: PlayerCharacter, skillId: string): number {
    const key = skillId as keyof PlayerCharacter["skills"];
    return hero.skills[key]?.level ?? 1;
  }

  function rebuildHeroDerived(hero: PlayerCharacter): void {
    rebuildCharacterDerived(hero, state.worldRecord);
  }

  function getHeroControllerOrThrow(charId: string): CharacterControllerImpl {
    const cc = characters.get(charId);
    if (!cc) {
      throw new Error(`session: no hero with id "${charId}"`);
    }
    return cc;
  }

  function computeXpForLevelGain(hero: PlayerCharacter, levels: number): number {
    if (!Number.isInteger(levels) || levels <= 0) {
      throw new Error(`session.debugGrantHeroLevels: levels must be a positive integer, got ${levels}`);
    }

    let totalXp = 0;
    let virtualLevel = hero.level;
    let carriedExp = hero.exp;

    for (let i = 0; i < levels && virtualLevel < hero.maxLevel; i += 1) {
      const cost = xpCostToReach(virtualLevel + 1, hero.xpCurve);
      totalXp += Math.max(0, cost - carriedExp);
      virtualLevel += 1;
      carriedExp = 0;
    }

    return totalXp;
  }

  function debugGrantHeroLevelsImpl(charId: string, levels: number): number {
    const hero = getHeroControllerOrThrow(charId).hero;
    const totalXp = computeXpForLevelGain(hero, levels);
    if (totalXp <= 0) return 0;

    const gained = grantCharacterXp(hero, totalXp, { bus });
    if (gained > 0) {
      rebuildHeroDerived(hero);
    }
    return gained;
  }

  function debugGiveItemImpl(charId: string, itemId: string, qty: number): void {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`session.debugGiveItem: qty must be a positive integer, got ${qty}`);
    }

    const hero = getHeroControllerOrThrow(charId).hero;
    addItemToInventory(hero.id, itemId, qty);
    bus.emit("inventoryChanged", { charId: hero.id, inventoryId: hero.id });
  }

  function cloneInventory(inv: Inventory): Inventory {
    return {
      capacity: inv.capacity,
      slots: inv.slots.map((slot) => {
        if (slot === null) return null;
        if (slot.kind === "stack") return { ...slot };
        return {
          kind: "gear",
          instance: {
            ...slot.instance,
            rolledMods: slot.instance.rolledMods.map((mod) => ({ ...mod })),
          },
        };
      }),
    };
  }

  function removeItemFromInventoryByItemId(
    inventory: Inventory,
    itemId: ItemId | string,
    qty: number,
  ): void {
    if (qty <= 0) {
      throw new Error(
        `session.removeItemFromInventoryByItemId: qty must be positive, got ${qty}`,
      );
    }
    let remaining = qty;
    for (let i = 0; i < inventory.slots.length && remaining > 0; i += 1) {
      const slot = inventory.slots[i];
      if (!slot) continue;
      const slotItemId = slot.kind === "stack" ? slot.itemId : slot.instance.itemId;
      if (slotItemId !== itemId) continue;
      if (slot.kind === "stack") {
        const take = Math.min(remaining, slot.qty);
        removeAtSlot(inventory, i, take);
        remaining -= take;
        continue;
      }
      removeAtSlot(inventory, i);
      remaining -= 1;
    }
    if (remaining > 0) {
      throw new Error(
        `session.removeItemFromInventoryByItemId: inventory is missing ${remaining} of "${itemId}"`,
      );
    }
  }

  function simulateRecipeInventoryChange(
    hero: PlayerCharacter,
    inventory: Inventory,
    recipe: RecipeDef,
  ): void {
    const draft = cloneInventory(inventory);
    for (const input of recipe.inputs) {
      removeItemFromInventoryByItemId(draft, input.itemId, input.qty);
    }
    for (const output of recipe.outputs) {
      const def = getItem(output.itemId);
      if (def.stackable) {
        const res = addStack(
          draft,
          output.itemId,
          output.qty,
          getInventoryStackLimit(state, hero.id),
        );
        if (!res.ok) {
          throw new Error(
            `session.simulateRecipeInventoryChange: inventory full, cannot fit recipe output "${output.itemId}"`,
          );
        }
        continue;
      }
      for (let i = 0; i < output.qty; i += 1) {
        const res = addGear(draft, {
          instanceId: `preview.${recipe.id}.${i}`,
          itemId: output.itemId,
          rolledMods: [],
        } satisfies GearInstance);
        if (!res.ok) {
          throw new Error(
            `session.simulateRecipeInventoryChange: inventory full, cannot fit recipe output gear "${output.itemId}"`,
          );
        }
      }
    }
  }

  function simulateAddSlotToInventory(
    inventoryOwnerId: string,
    inventory: Inventory,
    slot: NonNullable<Inventory["slots"][number]>,
    actionLabel: string,
  ): void {
    if (slot.kind === "stack") {
      const res = addStack(
        inventory,
        slot.itemId,
        slot.qty,
        getInventoryStackLimit(state, inventoryOwnerId),
      );
      if (!res.ok) {
        throw new Error(
          `${actionLabel}: inventory full for "${inventoryOwnerId}", cannot fit stack "${slot.itemId}" (remaining=${res.remaining})`,
        );
      }
      return;
    }

    const res = addGear(inventory, slot.instance);
    if (!res.ok) {
      throw new Error(
        `${actionLabel}: inventory full for "${inventoryOwnerId}", cannot fit gear "${slot.instance.itemId}"`,
      );
    }
  }

  function transferInventorySlot(
    charId: string,
    fromInventoryOwnerId: string,
    toInventoryOwnerId: string,
    slotIndex: number,
  ): void {
    if (fromInventoryOwnerId === toInventoryOwnerId) {
      throw new Error(
        `session.transferInventorySlot: source and target inventory are both "${fromInventoryOwnerId}"`,
      );
    }

    const sourceInventory = getInventoryByOwner(fromInventoryOwnerId);
    const targetInventory = getInventoryByOwner(toInventoryOwnerId);
    const sourceSlot = sourceInventory.slots[slotIndex];
    if (!sourceSlot) {
      throw new Error(
        `session.transferInventorySlot: slot ${slotIndex} is empty in inventory "${fromInventoryOwnerId}"`,
      );
    }

    simulateAddSlotToInventory(
      toInventoryOwnerId,
      cloneInventory(targetInventory),
      sourceSlot,
      "session.transferInventorySlot",
    );

    const removed = removeAtSlot(sourceInventory, slotIndex);
    simulateAddSlotToInventory(
      toInventoryOwnerId,
      targetInventory,
      removed,
      "session.transferInventorySlot(commit)",
    );

    const itemId = removed.kind === "stack" ? removed.itemId : removed.instance.itemId;
    const qty = removed.kind === "stack" ? removed.qty : 1;

    bus.emit("inventoryTransferred", {
      charId,
      itemId,
      qty,
      fromInventoryId: fromInventoryOwnerId,
      toInventoryId: toInventoryOwnerId,
    });
    bus.emit("inventoryChanged", { charId, inventoryId: fromInventoryOwnerId });
    bus.emit("inventoryChanged", { charId, inventoryId: toInventoryOwnerId });
  }

  function discardInventorySlot(
    charId: string,
    inventoryOwnerId: string,
    slotIndex: number,
  ): void {
    const inventory = getInventoryByOwner(inventoryOwnerId);
    const slot = inventory.slots[slotIndex];
    if (!slot) {
      throw new Error(
        `session.discardInventorySlot: slot ${slotIndex} is empty in inventory "${inventoryOwnerId}"`,
      );
    }

    const removed = removeAtSlot(inventory, slotIndex);
    bus.emit("inventoryDiscarded", {
      charId,
      inventoryId: inventoryOwnerId,
      itemId: removed.kind === "stack" ? removed.itemId : removed.instance.itemId,
      qty: removed.kind === "stack" ? removed.qty : 1,
    });
    bus.emit("inventoryChanged", { charId, inventoryId: inventoryOwnerId });
  }

  // ---------- Stage lifecycle helpers ----------


  function pendingLootEntrySummary(entry: StageSession["pendingLoot"][number]) {
    if (entry.kind === "stack") {
      return { itemId: entry.itemId, qty: entry.qty };
    }
    return { itemId: entry.instance.itemId, qty: 1 };
  }

  function emitPendingLootLost(charId: string, stageId: string): void {
    const session = state.stages[stageId];
    if (!session || session.pendingLoot.length === 0) return;
    bus.emit("pendingLootLost", {
      charId,
      stageId,
      entries: session.pendingLoot.map((entry) => pendingLootEntrySummary(entry)),
    });
  }

  /** Tear down a character's current stage + activity. */
  function tearDownCharInstance(
    cc: CharacterControllerImpl,
    reason: "player" | "left_location" | "switch_activity" | "system" = "system",
  ): void {
    // Stop activity.
    if (cc._activity) {
      if (cc._activity.kind === ACTIVITY_COMBAT_KIND) {
        // CombatActivity is a shared WorldActivity — any member leaving
        // stops the entire party (same semantics as dungeon abandon).
        const ca = cc._activity as CombatActivity;
        emitPendingLootLost(cc.hero.id, ca.stageId);
        bus.emit("activityStopped", {
          charId: cc.hero.id,
          kind: "combat",
          reason,
          stageId: ca.stageId,
        });
        ca.phase = "stopped";
        engine.unregister(ca.id);
        combatActivities.delete(ca.stageId);
        // Clear all party members' activity + stage references.
        for (const charId of ca.partyCharIds) {
          const otherCc = characters.get(charId);
          if (otherCc) {
            otherCc._activity = null;
            otherCc.hero.activity = null;
            if (otherCc.hero.stageId === ca.stageId) {
              otherCc.hero.stageId = null;
            }
          }
        }
        // Tear down the shared stage.
        const ctrl = stageControllers.get(ca.stageId);
        if (ctrl) {
          engine.unregister(ctrl.id);
          stageControllers.delete(ca.stageId);
        }
        leaveStageCore(ca.stageId, buildCtx());
        return; // stage already cleaned up above
      } else if (cc._activity.kind === ACTIVITY_GATHER_KIND) {
        const stageId = cc.hero.stageId;
        if (stageId) {
          emitPendingLootLost(cc.hero.id, stageId);
        }
        bus.emit("activityStopped", {
          charId: cc.hero.id,
          kind: "gather",
          reason,
          stageId: stageId ?? undefined,
        });
        (cc._activity as GatherActivity).stopRequested = true;
        engine.unregister(cc._activity.id);
        cc._activity = null;
        cc.hero.activity = null;
      }
    }
    // Leave stage (only if no other character references it).
    const stageId = cc.hero.stageId;
    if (stageId) {
      cc.hero.stageId = null;
      if (!hasOtherStageParticipant(stageId, cc.hero.id)) {
        const ctrl = stageControllers.get(stageId);
        if (ctrl) {
          engine.unregister(ctrl.id);
          stageControllers.delete(stageId);
        }
        leaveStageCore(stageId, buildCtx());
      }
    }
  }


  function hasOtherStageParticipant(stageId: string, excludeCharId: string): boolean {
    for (const [id, cc] of characters) {
      if (id !== excludeCharId && cc.hero.stageId === stageId) return true;
    }
    return false;
  }

  function startStageInstance(
    cc: CharacterControllerImpl,
    opts: {
      locationId: string;
      mode?: StageMode;
      resourceNodes?: string[];
    },
    teardownReason: "player" | "left_location" | "switch_activity" | "system" = "switch_activity",
  ): string {
    tearDownCharInstance(cc, teardownReason);
    const stageId = mintStageId(state);
    const ctrl = enterStageCore({
      stageId,
      locationId: opts.locationId,
      mode: opts.mode,
      resourceNodes: opts.resourceNodes,
      ctxProvider: buildCtx,
    });
    stageControllers.set(stageId, ctrl);
    engine.register(ctrl);
    cc.hero.stageId = stageId;
    return stageId;
  }

  function findSpawnedResourceNodeActorId(stageId: string, defId: string): string {
    const session = state.stages[stageId];
    if (!session) {
      throw new Error(
        `session.startGather: no active instance while resolving node "${defId}"`,
      );
    }
    for (const actorId of session.spawnedActorIds) {
      const actor = state.actors.find((a) => a.id === actorId);
      if (actor && isResourceNode(actor) && actor.defId === defId) {
        return actor.id;
      }
    }
    throw new Error(
      `session.startGather: spawned instance has no resource node for def "${defId}"`,
    );
  }

  // ---------- CharacterController implementation ----------

  interface CharacterControllerImpl extends CharacterController {
    hero: PlayerCharacter;
    _activity: CombatActivity | GatherActivity | null;
  }

  function createCharacterController(hero: PlayerCharacter): CharacterControllerImpl {
    const cc: CharacterControllerImpl = {
      hero,
      _activity: null,

      get activity() {
        return cc._activity;
      },

      get stageSession(): StageSession | null {
        return cc.hero.stageId ? state.stages[cc.hero.stageId] ?? null : null;
      },

      isRunning(): boolean {
        if (!cc._activity) return false;
        if (cc._activity.kind === ACTIVITY_COMBAT_KIND) return (cc._activity as CombatActivity).phase !== "stopped";
        if (cc._activity.kind === ACTIVITY_GATHER_KIND) return !(cc._activity as GatherActivity).stopRequested;
        return false;
      },

      enterLocation(locationId: string): void {
        getLocation(locationId);
        const previousLocationId = cc.hero.locationId;
        tearDownCharInstance(cc, "left_location");
        cc.hero.locationId = locationId;
        if (previousLocationId && previousLocationId !== locationId) {
          bus.emit("locationLeft", { charId: cc.hero.id, locationId: previousLocationId });
        }
        if (previousLocationId !== locationId) {
          bus.emit("locationEntered", { charId: cc.hero.id, locationId });
        }
      },

      leaveLocation(): void {
        const previousLocationId = cc.hero.locationId;
        tearDownCharInstance(cc, "left_location");
        cc.hero.locationId = null;
        if (previousLocationId) {
          bus.emit("locationLeft", { charId: cc.hero.id, locationId: previousLocationId });
        }
      },

      startFight(combatZoneId: string): void {
        if (!cc.hero.locationId) {
          console.warn("session.startFight: not in a location");
          return;
        }
        startPartyCombatImpl(combatZoneId, [cc.hero.id]);
      },

      startGather(nodeDefId: string): void {
        if (!cc.hero.locationId) {
          console.warn("session.startGather: not in a location");
          return;
        }
        const locationId = cc.hero.locationId;
        const stageId = startStageInstance(cc, {
          locationId,
          resourceNodes: [nodeDefId],
        });
        const nodeActorId = findSpawnedResourceNodeActorId(stageId, nodeDefId);
        cc._activity = createGatherActivity({
          ownerCharacterId: cc.hero.id,
          nodeId: nodeActorId,
          ctxProvider: buildCtx,
        });
        engine.register(cc._activity);
        bus.emit("activityStarted", {
          charId: cc.hero.id,
          kind: "gather",
          locationId,
          stageId,
          resourceNodeId: nodeDefId,
        });
      },

      stopActivity(): void {
        tearDownCharInstance(cc, "player");
      },


      equipItem(slotIndex: number): void {
        const hero = cc.hero;
        const inventory = getInventoryByOwner(hero.id);
        const slot = inventory.slots[slotIndex];
        if (!slot) {
          throw new Error(`session.equipItem: slot ${slotIndex} is empty`);
        }
        if (slot.kind !== "gear") {
          throw new Error(
            `session.equipItem: slot ${slotIndex} does not contain gear`,
          );
        }

        const def = getItem(slot.instance.itemId);
        if (!def.slot) {
          throw new Error(
            `session.equipItem: item "${slot.instance.itemId}" is not equippable`,
          );
        }

        const removed = removeAtSlot(inventory, slotIndex);
        if (removed.kind !== "gear") {
          throw new Error("session.equipItem: expected gear removal result");
        }

        const previous = hero.equipped[def.slot] ?? null;
        hero.equipped[def.slot] = removed.instance;
        if (previous) {
          inventory.slots[slotIndex] = { kind: "gear", instance: previous };
        }

        rebuildHeroDerived(hero);
        bus.emit("equipmentUpdated", {
          charId: hero.id,
          slot: def.slot,
          itemId: removed.instance.itemId,
          action: "equip",
        });
        bus.emit("equipmentChanged", { charId: hero.id, slot: def.slot });
      },

      unequipItem(slot: string): void {
        const hero = cc.hero;
        const equipped = hero.equipped[slot] ?? null;
        if (!equipped) {
          throw new Error(`session.unequipItem: slot "${slot}" is empty`);
        }
        const unequippedItemId = equipped.itemId;
        const res = addGear(getInventoryByOwner(hero.id), equipped);
        if (!res.ok) {
          throw new Error(
            `session.unequipItem: inventory full, cannot unequip "${equipped.itemId}" from slot "${slot}"`,
          );
        }
        hero.equipped[slot] = null;
        rebuildHeroDerived(hero);
        bus.emit("equipmentUpdated", {
          charId: hero.id,
          slot,
          itemId: unequippedItemId,
          action: "unequip",
        });
        bus.emit("equipmentChanged", { charId: hero.id, slot });
      },

      discardInventoryItem(inventoryOwnerId: string, slotIndex: number): void {
        discardInventorySlot(cc.hero.id, inventoryOwnerId, slotIndex);
      },

      storeItemInShared(slotIndex: number): void {
        transferInventorySlot(cc.hero.id, cc.hero.id, SHARED_INVENTORY_KEY, slotIndex);
      },

      takeItemFromShared(slotIndex: number): void {
        transferInventorySlot(cc.hero.id, SHARED_INVENTORY_KEY, cc.hero.id, slotIndex);
      },

      craftRecipe(recipeId: string): void {

        if (cc._activity) {
          throw new Error("session.craftRecipe: stop the current activity before crafting");
        }

        const hero = cc.hero;
        const recipe = getRecipe(recipeId);
        const skillDef = getSkill(recipe.skill);
        const currentLevel = getSkillLevel(hero, recipe.skill);
        if (currentLevel < recipe.requiredLevel) {
          throw new Error(
            `session.craftRecipe: recipe "${recipeId}" requires ${recipe.skill} level ${recipe.requiredLevel}, got ${currentLevel}`,
          );
        }

        const inventory = getInventoryByOwner(hero.id);
        simulateRecipeInventoryChange(hero, inventory, recipe);

        for (const input of recipe.inputs) {
          removeItemFromInventoryByItemId(inventory, input.itemId, input.qty);
        }
        for (const output of recipe.outputs) {
          addItemToInventory(hero.id, output.itemId, output.qty);
        }
        grantSkillXp(hero, skillDef, recipe.xpReward, { bus });

        bus.emit("inventoryChanged", { charId: hero.id, inventoryId: hero.id });
        bus.emit("crafted", { charId: hero.id, recipeId });
      },

      pickUpPendingLoot(index: number): boolean {
        const session = cc.stageSession;
        if (!session) return false;
        if (index < 0 || index >= session.pendingLoot.length) return false;

        const entry = session.pendingLoot[index]!;
        const hero = cc.hero;
        const stageId = hero.stageId;
        if (!stageId) {
          throw new Error("session.pickUpPendingLoot: pending loot exists without hero.stageId");
        }
        const inv = getInventoryByOwner(hero.id);

        if (entry.kind === "stack") {
          const res = addStack(
            inv,
            entry.itemId,
            entry.qty,
            getInventoryStackLimit(state, hero.id),
          );
          if (!res.ok) return false;
        } else {
          const res = addGear(inv, entry.instance);
          if (!res.ok) return false;
        }

        session.pendingLoot.splice(index, 1);
        bus.emit("pendingLootPicked", {
          charId: hero.id,
          stageId,
          itemId: entry.kind === "stack" ? entry.itemId : entry.instance.itemId,
          qty: entry.kind === "stack" ? entry.qty : 1,
        });
        bus.emit("inventoryChanged", { charId: hero.id, inventoryId: hero.id });
        bus.emit("pendingLootChanged", { charId: hero.id, stageId });
        return true;
      },


      pickUpAllPendingLoot(): number {
        const session = cc.stageSession;
        if (!session) return 0;

        const hero = cc.hero;
        const stageId = hero.stageId;
        if (!stageId) return session.pendingLoot.length;
        const inv = getInventoryByOwner(hero.id);
        const before = session.pendingLoot.length;
        const kept: typeof session.pendingLoot = [];

        for (const entry of session.pendingLoot) {
          if (entry.kind === "stack") {
            const res = addStack(
              inv,
              entry.itemId,
              entry.qty,
              getInventoryStackLimit(state, hero.id),
            );
            const pickedQty = res.ok ? entry.qty : entry.qty - res.remaining;
            if (pickedQty > 0) {
              bus.emit("pendingLootPicked", {
                charId: hero.id,
                stageId,
                itemId: entry.itemId,
                qty: pickedQty,
              });
            }
            if (!res.ok) {
              // Partial placement: addStack already committed what fits.
              // Keep the remainder in pending.
              kept.push({ kind: "stack", itemId: entry.itemId, qty: res.remaining });
              continue;
            }
          } else {
            const res = addGear(inv, entry.instance);
            if (!res.ok) {
              kept.push(entry);
              continue;
            }
            bus.emit("pendingLootPicked", {
              charId: hero.id,
              stageId,
              itemId: entry.instance.itemId,
              qty: 1,
            });
          }
        }

        session.pendingLoot = kept;
        if (kept.length < before) {
          bus.emit("inventoryChanged", { charId: hero.id, inventoryId: hero.id });
          bus.emit("pendingLootChanged", { charId: hero.id, stageId });
        }
        return kept.length;
      },

      allocateTalent(talentId: string): void {
        const result = allocateTalentPoint(cc.hero, talentId as any, content);
        if (!result.ok) {
          throw new Error(`session.allocateTalent: ${result.reason} for talent "${talentId}"`);
        }
        bus.emit("talentAllocated", {
          charId: cc.hero.id,
          talentId,
          newLevel: result.newLevel,
        });
      },

      equipTalent(talentId: string): void {
        const result = equipTalentCore(cc.hero, talentId as any, content);
        if (!result.ok) {
          throw new Error(`session.equipTalent: ${result.reason} for talent "${talentId}"`);
        }
      },

      unequipTalent(talentId: string): void {
        const result = unequipTalentCore(cc.hero, talentId as any, content);
        if (!result.ok) {
          throw new Error(`session.unequipTalent: ${result.reason} for talent "${talentId}"`);
        }
      },
    };

    return cc;
  }

  // ---------- Rehydrate after load ----------

  /** Rebuild characters Map + stageControllers from a loaded state. */
  function rehydrateAll(): void {
    // Clear old runtime objects.
    for (const cc of characters.values()) {
      if (cc._activity) engine.unregister(cc._activity.id);
    }
    for (const ctrl of stageControllers.values()) {
      engine.unregister(ctrl.id);
    }
    characters.clear();
    stageControllers.clear();
    combatActivities.clear();
    assertRuntimeIdState(state);

    // Rebuild character controllers.
    for (const actor of state.actors) {
      if (!isPlayer(actor)) continue;
      const hero = actor as PlayerCharacter;
      const cc = createCharacterController(hero);
      characters.set(hero.id, cc);
    }

    // Rebuild stage controllers from state.stages.
    for (const [stageId, session] of Object.entries(state.stages)) {
      const ctrl = enterStageCore({
        stageId,
        locationId: session.locationId,
        mode: session.mode,
        ctxProvider: buildCtx,
        resume: true,
      });
      stageControllers.set(stageId, ctrl);
      engine.register(ctrl);
    }

    // Rehydrate dungeon world activities from state.dungeons.
    for (const [dsId, ds] of Object.entries(state.dungeons)) {
      if (ds.status !== "in_progress") continue;

      const partyLeader = ds.partyCharIds
        .map((charId) => state.actors.find((actor) => actor.id === charId))
        .find((actor): actor is PlayerCharacter => !!actor && isPlayer(actor));
      const heroActivity = partyLeader?.activity?.kind === ACTIVITY_DUNGEON_KIND
        ? (partyLeader.activity.data as DungeonActivityData)
        : null;

      const da = createDungeonActivity({
        dungeonSessionId: dsId,
        ctxProvider: buildCtx,
        restoreParty: () => restoreDungeonParty(dsId, { state }),
        resume: {
          phase: heroActivity?.phase ?? ds.phase,
          currentBattleId: heroActivity?.currentBattleId ?? null,
          transitionTick: heroActivity?.transitionTick ?? ds.transitionTick,

        },
      });
      dungeonActivities.set(dsId, da);
      engine.register(da);
    }


    // Rehydrate activities for each character.
    // Combat activities are now WorldActivities keyed by stageId — deduplicate.
    const rehydratedCombatStages = new Set<string>();
    for (const cc of characters.values()) {
      const hero = cc.hero;
      if (!hero.activity) continue;
      if (hero.activity.kind === ACTIVITY_COMBAT_KIND) {
        const data = hero.activity.data as CombatActivityData;
        // Only create one CombatActivity per stageId (party shares it).
        if (rehydratedCombatStages.has(data.stageId)) {
          // Already rehydrated — just link the controller.
          const existing = combatActivities.get(data.stageId);
          if (existing) cc._activity = existing;
          continue;
        }
        rehydratedCombatStages.add(data.stageId);
        const ca = createCombatActivity({
          stageId: data.stageId,
          partyCharIds: data.partyCharIds ?? [hero.id],
          ctxProvider: buildCtx,
          resume: {
            phase: data.phase,
            currentBattleId: data.currentBattleId,
            lastTransitionTick: data.lastTransitionTick,
          },


        });
        combatActivities.set(data.stageId, ca);
        cc._activity = ca;
        if (ca.phase !== "stopped") engine.register(ca);
      } else if (hero.activity.kind === ACTIVITY_GATHER_KIND) {
        const data = hero.activity.data as GatherActivityData;
        cc._activity = createGatherActivity({
          ownerCharacterId: hero.id,
          nodeId: data.nodeId,
          ctxProvider: buildCtx,
          resume: { progressTicks: data.progressTicks },
        });
        engine.register(cc._activity);
      }
    }
    // Link all party members' controllers to their shared combat activity.
    for (const ca of combatActivities.values()) {
      for (const charId of ca.partyCharIds) {
        const cc = characters.get(charId);
        if (cc && !cc._activity) cc._activity = ca;
      }
    }

  }

  // ---------- Party combat lifecycle ----------

  function startPartyCombatImpl(
    combatZoneId: string,
    partyCharIds: string[],
  ): void {
    const def = getCombatZone(combatZoneId);
    if (partyCharIds.length === 0) {
      throw new Error("session.startPartyCombat: partyCharIds must not be empty");
    }
    if (def.minPartySize && partyCharIds.length < def.minPartySize) {
      throw new Error(
        `session.startPartyCombat: need at least ${def.minPartySize} characters, got ${partyCharIds.length}`,
      );
    }
    if (def.maxPartySize && partyCharIds.length > def.maxPartySize) {
      throw new Error(
        `session.startPartyCombat: max ${def.maxPartySize} characters, got ${partyCharIds.length}`,
      );
    }

    // Validate and collect all character controllers.
    const ccs: CharacterControllerImpl[] = [];
    for (const charId of partyCharIds) {
      const cc = characters.get(charId);
      if (!cc) throw new Error(`session.startPartyCombat: no character "${charId}"`);
      ccs.push(cc);
    }

    // All characters must be in a location (use the first character's location).
    const locationId = ccs[0]!.hero.locationId;
    if (!locationId) {
      throw new Error("session.startPartyCombat: first character not in a location");
    }

    // Tear down existing activities for all party members.
    for (const cc of ccs) {
      tearDownCharInstance(cc, "switch_activity");
    }


    // Create a shared stage.
    const stageId = mintStageId(state);
    const ctrl = enterStageCore({
      stageId,
      locationId,
      mode: { kind: "combatZone", combatZoneId },
      ctxProvider: buildCtx,
    });
    stageControllers.set(stageId, ctrl);
    engine.register(ctrl);

    // Point all characters to the shared stage.
    for (const cc of ccs) {
      cc.hero.stageId = stageId;
    }

    // Create the shared CombatActivity (now a WorldActivity).
    const combatActivity = createCombatActivity({
      stageId,
      partyCharIds: partyCharIds.slice(),
      ctxProvider: buildCtx,
    });
    combatActivity.onStart?.(buildCtx());
    combatActivities.set(stageId, combatActivity);
    engine.register(combatActivity);

    // Set _activity reference on all controllers for UI queries.
    for (const cc of ccs) {
      cc._activity = combatActivity;
    }

    bus.emit("activityStarted", {
      charId: partyCharIds[0]!,
      kind: "combat",
      locationId,
      stageId,
      combatZoneId,
    });
  }


  // ---------- Dungeon lifecycle ----------

  function restoreDungeonParty(
    dungeonSessionId: string,
    ctx: { state: GameState },
  ): void {
    const ds = ctx.state.dungeons[dungeonSessionId];
    if (!ds) return;

    for (const charId of ds.partyCharIds) {
      const cc = characters.get(charId);
      if (!cc) continue;
      const saved = ds.savedActivities[charId];
      // Remove any dungeon-participant activity.
      if (cc._activity) {
        engine.unregister(cc._activity.id);
        cc._activity = null;
      }
      cc.hero.activity = saved?.activity ?? null;
      cc.hero.locationId = saved?.locationId ?? null;
      cc.hero.stageId = saved?.stageId ?? null;
      cc.hero.dungeonSessionId = null;
      // Note: we do NOT restore old stage controllers or activities here.
      // The character returns to idle at their saved location. If they had an
      // activity before, it was snapshot'd as data; we'd need rehydration to
      // actually resume it. For alpha, just restoring location is sufficient.
      // Clear the persisted activity since we can't seamlessly resume it.
      cc.hero.activity = null;
      cc.hero.stageId = null;
    }

    // Tear down dungeon stage.
    const stageId = ds.stageId;
    const ctrl = stageControllers.get(stageId);
    if (ctrl) {
      engine.unregister(ctrl.id);
      stageControllers.delete(stageId);
    }
    leaveStageCore(stageId, buildCtx());

    // Clean up dungeon activity.
    const da = dungeonActivities.get(dungeonSessionId);
    if (da) {
      engine.unregister(da.id);
      dungeonActivities.delete(dungeonSessionId);
    }

    // Remove the dungeon session.
    delete ctx.state.dungeons[dungeonSessionId];
  }

  function startDungeonImpl(
    dungeonId: string,
    partyCharIds: string[],
  ): void {
    const def = getDungeon(dungeonId);

    if (partyCharIds.length === 0) {
      throw new Error("session.startDungeon: partyCharIds must not be empty");
    }
    if (def.minPartySize && partyCharIds.length < def.minPartySize) {
      throw new Error(
        `session.startDungeon: need at least ${def.minPartySize} characters, got ${partyCharIds.length}`,
      );
    }
    if (def.maxPartySize && partyCharIds.length > def.maxPartySize) {
      throw new Error(
        `session.startDungeon: max ${def.maxPartySize} characters, got ${partyCharIds.length}`,
      );
    }

    // Validate all characters exist and are idle.
    const ccs: CharacterControllerImpl[] = [];
    for (const charId of partyCharIds) {
      const cc = characters.get(charId);
      if (!cc) throw new Error(`session.startDungeon: no character "${charId}"`);
      ccs.push(cc);
    }

    // Save current states and tear down existing activities.
    const savedActivities: Record<string, { locationId: string | null; stageId: string | null; activity: typeof ccs[0]["hero"]["activity"] }> = {};
    for (const cc of ccs) {
      savedActivities[cc.hero.id] = {
        locationId: cc.hero.locationId,
        stageId: cc.hero.stageId,
        activity: cc.hero.activity
          ? { ...cc.hero.activity, data: { ...cc.hero.activity.data } }
          : null,
      };
      tearDownCharInstance(cc, "switch_activity");
    }


    // Create shared stage for the dungeon.
    const stageId = mintStageId(state);
    const locationId = `dungeon.${dungeonId}`;
    const dungeonSessionId = mintDungeonSessionId(state);

    const ctrl = enterStageCore({
      stageId,
      locationId,
      mode: { kind: "dungeon", dungeonSessionId },
      ctxProvider: buildCtx,
    });
    stageControllers.set(stageId, ctrl);
    engine.register(ctrl);

    // Create DungeonSession in state.
    const ds: DungeonSession = {
      dungeonId,
      partyCharIds: partyCharIds.slice(),
      savedActivities,
      currentWaveIndex: 0,
      status: "in_progress",
      phase: "spawningWave",
      transitionTick: engine.currentTick,
      startedAtTick: engine.currentTick,
      stageId,
    };


    state.dungeons[dungeonSessionId] = ds;

    // Point all characters to the dungeon.
    for (const cc of ccs) {
      cc.hero.locationId = locationId;
      cc.hero.stageId = stageId;
      cc.hero.dungeonSessionId = dungeonSessionId;
      // Set a dungeon participant activity on the hero.
      cc.hero.activity = {
        kind: ACTIVITY_DUNGEON_KIND,
        startedAtTick: engine.currentTick,
        data: {
          dungeonSessionId,
          phase: "spawningWave",
          currentBattleId: null,
          transitionTick: engine.currentTick,
        },
      };


    }

    // Create and register the DungeonWorldActivity.
    const dungeonActivity = createDungeonActivity({
      dungeonSessionId,
      ctxProvider: buildCtx,
      restoreParty: () => restoreDungeonParty(dungeonSessionId, { state }),
    });
    dungeonActivities.set(dungeonSessionId, dungeonActivity);
    engine.register(dungeonActivity);

    bus.emit("activityStarted", {
      charId: partyCharIds[0]!,
      kind: "dungeon",
      locationId,
      stageId,
      dungeonSessionId,
      dungeonId,
    });
  }


  function abandonDungeonImpl(charId: string): void {
    const cc = characters.get(charId);
    if (!cc) throw new Error(`session.abandonDungeon: no character "${charId}"`);
    const dsId = cc.hero.dungeonSessionId;
    if (!dsId) throw new Error(`session.abandonDungeon: character "${charId}" is not in a dungeon`);
    const ds = state.dungeons[dsId];
    if (!ds) throw new Error(`session.abandonDungeon: no dungeon session "${dsId}"`);
    const da = dungeonActivities.get(dsId);
    if (da) {
      abandonDungeonCore(da, ds, buildCtx(), () =>
        restoreDungeonParty(dsId, { state }),
      );
    } else {
      // No activity found — just clean up.
      restoreDungeonParty(dsId, { state });
    }
  }

  function purchaseUpgradeImpl(upgradeId: string): void {
    const result = purchaseUpgradeCore(upgradeId, {
      state,
      content,
    });
    if (!result.success) return;

    if (result.cost !== 0) {
      bus.emit("currencyChanged", {
        currencyId: result.costCurrency,
        amount: -result.cost,
        total: state.currencies[result.costCurrency] ?? 0,
        source: "upgrade_purchase",
      });
    }
    bus.emit("upgradePurchased", {
      upgradeId,
      level: result.level,
      costCurrency: result.costCurrency,
      cost: result.cost,
    });
  }


  // ---------- Public lifecycle ----------

  function loadFromSave(loaded: GameState): void {
    state = loaded;
    assertRuntimeIdState(state);
    rng = restoreRng(loaded.rngState);
    engine.setTick(loaded.tick);
    rehydrateAll();
  }

  function resetToFresh(): void {
    // Tear down all existing characters.
    for (const cc of characters.values()) {
      tearDownCharInstance(cc);
    }
    characters.clear();
    stageControllers.clear();
    for (const da of dungeonActivities.values()) engine.unregister(da.id);
    dungeonActivities.clear();
    for (const ca of combatActivities.values()) engine.unregister(ca.id);
    combatActivities.clear();

    state = createEmptyState(seed, SAVE_VERSION);
    rng = createRng(seed);
    battleSchedulerMode = DEFAULT_BATTLE_SCHEDULER_MODE;
    engine.setTick(0);


    const starting = content.starting;
    if (!starting) {
      throw new Error(
        "session.resetToFresh: content.starting is not configured; " +
          "set ContentDb.starting before booting a new game",
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
    state.focusedCharId = starting.heroes[0]!.id;

    // Create all starting heroes.
    for (const heroCfg of starting.heroes) {
      const hero = createPlayerCharacter({
        id: heroCfg.id,
        name: heroCfg.name,
        heroConfigId: heroCfg.id,
        xpCurve: heroCfg.xpCurve,
        knownTalents: heroCfg.knownTalents.slice(),
        baseAttrs: heroCfg.baseAttrs as Record<string, number> | undefined,
      });
      state.actors.push(hero);
      if (!state.inventories[hero.id]) {
        state.inventories[hero.id] = createInventory(
          heroCfg.inventoryCapacity ?? DEFAULT_CHAR_INVENTORY_CAPACITY,
        );
      }
      if (heroCfg.startingItems?.length) {
        for (const entry of heroCfg.startingItems) {
          addItemToInventory(hero.id, entry.itemId, entry.qty);
        }
      }
      const cc = createCharacterController(hero);
      characters.set(hero.id, cc);

      // 自动装备起始 gear：遍历背包，找到可装备且对应 slot 空着的 gear 就直接装上。
      // 使用 equipItem 确保 rebuildCharacterDerived 正确触发，modifier 堆叠不遗漏。
      const inv = state.inventories[hero.id]!;
      for (let i = 0; i < inv.slots.length; i++) {
        const slot = inv.slots[i];
        if (!slot || slot.kind !== "gear") continue;
        const itemDef = getItem(slot.instance.itemId);
        if (!itemDef.slot) continue;
        if (hero.equipped[itemDef.slot]) continue; // slot already filled
        cc.equipItem(i);
        break; // 每个 slot 只装一件，起始配置不需要循环多次
      }

      // Enter the initial location for each hero.
      cc.enterLocation(starting.initialLocationId);
    }
  }

  // ---------- Speed ----------

  function setSpeedMultiplier(mul: number): void {
    engine.speedMultiplier = mul;
  }

  function getSpeedMultiplier(): number {
    return engine.speedMultiplier;
  }

  function setBattleSchedulerMode(mode: BattleSchedulerMode): void {
    battleSchedulerMode = mode;
  }

  function getBattleSchedulerMode(): BattleSchedulerMode {
    return battleSchedulerMode;
  }

  // ---------- Public API ----------


  const session: GameSession = {
    get state() {
      state.tick = engine.currentTick;
      state.rngState = rng.state;
      return state;
    },
    get engine() {
      return engine;
    },
    get bus() {
      return bus;
    },
    get focusedCharId() {
      return state.focusedCharId;
    },

    getCharacter(charId: string): CharacterController {
      const cc = characters.get(charId);
      if (!cc) {
        throw new Error(`session.getCharacter: no character with id "${charId}"`);
      }
      return cc;
    },
    getFocusedCharacter(): CharacterController {
      return session.getCharacter(state.focusedCharId);
    },
    setFocusedChar(charId: string): void {
      if (!characters.has(charId)) {
        throw new Error(`session.setFocusedChar: no character with id "${charId}"`);
      }
      state.focusedCharId = charId;
    },
    listHeroes(): PlayerCharacter[] {
      return Array.from(characters.values()).map((cc) => cc.hero);
    },

    startDungeon: startDungeonImpl,
    startPartyCombat: startPartyCombatImpl,
    abandonDungeon: abandonDungeonImpl,
    purchaseUpgrade: purchaseUpgradeImpl,
    setSpeedMultiplier,
    setBattleSchedulerMode,
    debugGrantHeroLevels: debugGrantHeroLevelsImpl,
    debugGiveItem: debugGiveItemImpl,

    getSpeedMultiplier,
    getBattleSchedulerMode,

    loadFromSave,
    resetToFresh,
    dispose() {
      disposeGameLogCollector();
      stopLoop();
    },

  };

  return session;
}
