// Canonical shape of the game's persistent state.
//
// Hard rules:
// - Plain data only. No class instances, no functions, no Maps/Sets.
// - Must round-trip through JSON.stringify/parse for PERSISTED fields.
// - Derived fields live on Actors but are OMITTED by the save serializer
//   (see src/core/save/serialize.ts for the explicit whitelist).
// - DO store currentHp / currentMp directly (clamp to [0, max] on load to
//   guard against max being lowered between saves).
// - All IDs are dot-namespaced strings (e.g. "ability.fire.fireball").

import type { SkillId } from "../content/types";
import type { Actor } from "../actor/types";
import type { Battle } from "../combat/battle";

// ---------- Active effects ----------

export interface ActiveEffect {
  effectId: string;          // content ID
  sourceId: string;          // opaque — unique per instance so modifiers can be revoked cleanly
  remainingTicks: number;    // duration; omit / negative => permanent (avoid)
  stacks?: number;           // if the effect supports stacking
}

// ---------- Inventory ----------

export interface ItemStack {
  itemId: string;
  qty: number;
}

// ---------- Per-skill progress ----------

export interface SkillProgress {
  xp: number;
  level: number;
}

// ---------- Character activity ----------

export interface CharacterActivityState {
  kind: string;                     // e.g. "activity.combat"
  startedAtTick: number;
  data: Record<string, unknown>;    // activity-specific payload (serializable)
}

// ---------- World activities ----------

export interface WorldActivityState {
  id: string;                       // instance id (e.g. "crop.plot-1")
  kind: string;                     // e.g. "activity.crop"
  startedAtTick: number;
  data: Record<string, unknown>;
}

// ---------- Root state ----------

export interface GameSettings {
  speedMultiplier: number;
}

export interface GameState {
  /** Save schema version. Bumped when migrations are required. */
  version: number;
  /** Seed the RNG stream started from. Kept for debugging / replay. */
  rngSeed: number;
  /** Current RNG state (serialized mulberry32 state). */
  rngState: number;
  /** Logic ticks since this save was first created. Monotonic. */
  tick: number;
  /**
   * All world actors (PlayerCharacter + Enemy + future kinds).
   * Source of truth. Battles reference participants by id; they do NOT
   * contain copies of the actors they fight with.
   */
  actors: Actor[];
  /** Active battles indexed by id. Battle is plain data so it round-trips
   *  through the save file. Activities reference battles by id. */
  battles: Battle[];
  /** Inventories keyed by charId OR the literal "shared" key. */
  inventories: Record<string, ItemStack[]>;
  worldActivities: WorldActivityState[];
  /** Generic counters / unlock flags / quest progress. */
  flags: Record<string, number>;
  settings: GameSettings;
}

// ---------- Helpers ----------

export const SHARED_INVENTORY_KEY = "shared";

/** Build a fresh, well-formed empty state. */
export function createEmptyState(seed: number, version: number): GameState {
  return {
    version,
    rngSeed: seed >>> 0,
    rngState: seed >>> 0,
    tick: 0,
    actors: [],
    battles: [],
    inventories: { [SHARED_INVENTORY_KEY]: [] },
    worldActivities: [],
    flags: {},
    settings: { speedMultiplier: 1 },
  };
}
