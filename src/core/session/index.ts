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
import { createRng, restoreRng, type Rng } from "../infra/rng";
import {
  createEmptyState,
  type GameState,
  type DungeonSession,
} from "../infra/state";
import { SAVE_VERSION } from "../save/migrations";
import type { ContentDb, ItemId, RecipeDef } from "../content";
import { getItem, getLocation, getRecipe, getSkill, getDungeon, setContent } from "../content";
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
  createPlayerCharacter,
  isPlayer,
  isResourceNode,
  rebuildCharacterDerived,
  type PlayerCharacter,
} from "../entity/actor";
import { registerBuiltinIntents } from "../combat/intent";
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
import { grantSkillXp } from "../growth/leveling";
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
  craftRecipe(recipeId: string): void;
  /** Try to move a specific pending-loot entry into the hero's inventory.
   *  Returns true if successful, false if inventory is still full. */
  pickUpPendingLoot(index: number): boolean;
  /** Try to move all pending loot into inventory. Returns the count of
   *  entries that could not be picked up (still pending). */
  pickUpAllPendingLoot(): number;
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

  // Global commands.
  setSpeedMultiplier(mul: number): void;
  getSpeedMultiplier(): number;

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
  const attrDefs = content.attributes;

  // --- Mutable runtime slots. Swapped on reload. buildCtx always closes
  //     over the current values through the bindings below.
  let state: GameState = createEmptyState(seed, SAVE_VERSION);
  let rng: Rng = createRng(seed);
  const bus = createGameEventBus();
  const engine = createTickEngine({ initialSpeedMultiplier: 1 });

  // Per-hero runtime controllers. Rebuilt on resetToFresh / loadFromSave.
  const characters = new Map<string, CharacterControllerImpl>();
  // Per-stage runtime controllers. Independent of characters because a stage
  // may be shared by multiple heroes in the future (co-op).
  const stageControllers = new Map<string, StageController>();

  // The engine runs in real time; Store attaches __ui_notifier on top.
  const stopLoop = engine.start();

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
      attrDefs,
      currentTick: engine.currentTick,
    };
  }

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
        getInventoryStackLimit(state, inventoryOwnerId, attrDefs),
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
    rebuildCharacterDerived(hero, attrDefs, state.worldRecord);
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
          getInventoryStackLimit(state, hero.id, attrDefs),
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

  // ---------- Stage lifecycle helpers ----------

  /** Tear down a character's current stage + activity. */
  function tearDownCharInstance(cc: CharacterControllerImpl): void {
    // Stop activity.
    if (cc._activity) {
      if (cc._activity.kind === ACTIVITY_COMBAT_KIND) {
        // CombatActivity is a shared WorldActivity — any member leaving
        // stops the entire party (same semantics as dungeon abandon).
        const ca = cc._activity as CombatActivity;
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
  ): string {
    tearDownCharInstance(cc);
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
        tearDownCharInstance(cc);
        cc.hero.locationId = locationId;
      },

      leaveLocation(): void {
        tearDownCharInstance(cc);
        cc.hero.locationId = null;
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
        const stageId = startStageInstance(cc, {
          locationId: cc.hero.locationId,
          resourceNodes: [nodeDefId],
        });
        const nodeActorId = findSpawnedResourceNodeActorId(stageId, nodeDefId);
        cc._activity = createGatherActivity({
          ownerCharacterId: cc.hero.id,
          nodeId: nodeActorId,
          ctxProvider: buildCtx,
        });
        engine.register(cc._activity);
      },

      stopActivity(): void {
        tearDownCharInstance(cc);
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
        bus.emit("equipmentChanged", { charId: hero.id, slot: def.slot });
      },

      unequipItem(slot: string): void {
        const hero = cc.hero;
        const equipped = hero.equipped[slot] ?? null;
        if (!equipped) {
          throw new Error(`session.unequipItem: slot "${slot}" is empty`);
        }
        const res = addGear(getInventoryByOwner(hero.id), equipped);
        if (!res.ok) {
          throw new Error(
            `session.unequipItem: inventory full, cannot unequip "${equipped.itemId}" from slot "${slot}"`,
          );
        }
        hero.equipped[slot] = null;
        rebuildHeroDerived(hero);
        bus.emit("equipmentChanged", { charId: hero.id, slot });
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
        const inv = getInventoryByOwner(hero.id);

        if (entry.kind === "stack") {
          const res = addStack(
            inv,
            entry.itemId,
            entry.qty,
            getInventoryStackLimit(state, hero.id, attrDefs),
          );
          if (!res.ok) return false;
        } else {
          const res = addGear(inv, entry.instance);
          if (!res.ok) return false;
        }

        session.pendingLoot.splice(index, 1);
        bus.emit("inventoryChanged", { charId: hero.id, inventoryId: hero.id });
        bus.emit("pendingLootChanged", { charId: hero.id, stageId: hero.stageId! });
        return true;
      },

      pickUpAllPendingLoot(): number {
        const session = cc.stageSession;
        if (!session) return 0;

        const hero = cc.hero;
        const inv = getInventoryByOwner(hero.id);
        const before = session.pendingLoot.length;
        const kept: typeof session.pendingLoot = [];

        for (const entry of session.pendingLoot) {
          if (entry.kind === "stack") {
            const res = addStack(
              inv,
              entry.itemId,
              entry.qty,
              getInventoryStackLimit(state, hero.id, attrDefs),
            );
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
          }
        }

        session.pendingLoot = kept;
        if (kept.length < before) {
          bus.emit("inventoryChanged", { charId: hero.id, inventoryId: hero.id });
          bus.emit("pendingLootChanged", { charId: hero.id, stageId: hero.stageId! });
        }
        return kept.length;
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
      const da = createDungeonActivity({
        dungeonSessionId: dsId,
        ctxProvider: buildCtx,
        restoreParty: () => restoreDungeonParty(dsId, { state }),
        resume: {
          phase: "spawningWave", // conservative: restart from spawning
          currentBattleId: null,
          transitionTick: engine.currentTick,
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
    for (const [stageId, ca] of combatActivities) {
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
    if (partyCharIds.length === 0) {
      throw new Error("session.startPartyCombat: partyCharIds must not be empty");
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
      tearDownCharInstance(cc);
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
      tearDownCharInstance(cc);
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

    // Create all starting heroes.
    for (const heroCfg of starting.heroes) {
      const hero = createPlayerCharacter({
        id: heroCfg.id,
        name: heroCfg.name,
        xpCurve: heroCfg.xpCurve,
        knownAbilities: heroCfg.knownAbilities.slice(),
        attrDefs,
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
      // Enter the initial location for each hero.
      cc.enterLocation(starting.initialLocationId);
    }

    state.focusedCharId = starting.heroes[0]!.id;
  }

  // ---------- Speed ----------

  function setSpeedMultiplier(mul: number): void {
    engine.speedMultiplier = mul;
  }

  function getSpeedMultiplier(): number {
    return engine.speedMultiplier;
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
    setSpeedMultiplier,
    getSpeedMultiplier,
    loadFromSave,
    resetToFresh,
    dispose() {
      stopLoop();
    },
  };

  return session;
}
