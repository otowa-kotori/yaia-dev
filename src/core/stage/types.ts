// Stage session primitives.
//
// With the Location / Entry / Instance split:
//   - LocationDef      — "where am I" (physical place)
//   - LocationEntryDef — "what can I do here" (combat / gather entry)
//   - StageSession     — the running instance after the player picks an entry
//
// A StageSession owns a population of Actors (enemies, resource nodes).
// It does NOT run battles or gather loops — those belong to the Activity
// layer. Its responsibilities:
//
//   - spawning the initial population on enter
//   - progressing an explicitly requested combat-wave search
//   - cleaning up its population on leave
//
// The player can be in at most one running instance per character:
// hero.stageId references an entry in state.stages.
// hero.locationId records which location the character is in.
//
// Stage state is JSON-safe (plain data) so it round-trips through saves.
// Runtime logic (the "controller") is not persisted; it's re-instantiated
// from state.currentStage on load.

import type { ItemId } from "../content/types";
import type { GearInstance } from "../item/types";

// ---------- Pending loot ----------
//
// When an Activity (combat / gather) generates item rewards but the hero's
// inventory is full, the overflow lands here instead of crashing. The player
// picks items up manually; anything left behind when the stage is abandoned
// is lost. Unlimited size — the stage is short-lived so this won't bloat.

export interface PendingLootStack {
  kind: "stack";
  itemId: ItemId;
  qty: number;
}

export interface PendingLootGear {
  kind: "gear";
  instance: GearInstance;
}

export type PendingLootEntry = PendingLootStack | PendingLootGear;

export interface ActiveCombatWaveSession {
  encounterId: string;
  waveId: string;
  waveIndex: number;
  enemyIds: string[];
  /** active = unresolved, victory/defeat = battle resolved and awaiting cleanup. */
  status: "active" | "victory" | "defeat";
  rewardGranted: boolean;
}

export interface PendingCombatWaveSearch {
  /** Tick at which the current search started. */
  startedAtTick: number;
  /** Tick at or after which the next wave becomes spawnable. */
  readyAtTick: number;
}

/**
 * Per-instance state stored in GameState.stages[stageId]. Minimal bookkeeping
 * for actor ownership + combat-wave search so leaveStage can clean up.
 */
export interface StageSession {
  /** The location this instance belongs to. */
  locationId: string;
  /** The encounter being played (null for gather-only instances). */
  encounterId: string | null;
  enteredAtTick: number;
  /** Ids of actors spawned BY this instance (so we know what to clean up on
   *  leave). Actors that pre-date the instance, like the player character,
   *  are not in this list. */
  spawnedActorIds: string[];
  /** Monotonically increasing wave counter. Used to build unique enemy ids. */
  combatWaveIndex: number;
  /** Non-null while the player is actively searching for the next combat wave. */
  pendingCombatWaveSearch: PendingCombatWaveSearch | null;
  /** The wave currently spawned, or the most recently resolved wave before cleanup finishes. */
  currentWave: ActiveCombatWaveSession | null;
  /** Items that could not fit into the hero's inventory. The player may pick
   *  them up manually. Cleared when the stage is abandoned (with a UI
   *  confirmation if non-empty). */
  pendingLoot: PendingLootEntry[];
}
