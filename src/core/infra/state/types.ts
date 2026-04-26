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

import type { Actor } from "../../entity/actor/types";
import type { Battle } from "../../combat/battle/battle";
import type { StageSession } from "../../world/stage/types";
import type { Inventory, StackEntry } from "../../inventory/types";
import {
  DEFAULT_SHARED_INVENTORY_CAPACITY,
  DEFAULT_SHARED_STACK_LIMIT,
  createInventory,
} from "../../inventory";
import type { GameLogEntry } from "../game-log";

// ---------- Effect instances ----------

export interface EffectInstance {
  effectId: string;            // content ID
  sourceId: string;            // opaque — unique per instance so modifiers can be revoked cleanly
  sourceActorId: string;       // who applied this effect
  sourceTalentId?: string;     // which talent installed this (for passive/sustain refresh)
  remainingActions: number;    // duration in owner action counts; -1 = infinite
  stacks: number;              // for stackable mode; default 1
  /** Instance-specific data. JSON-safe. EffectDef functions read/write this. */
  state: Record<string, unknown>;
}

// ---------- Inventory ----------
//
// Legacy name kept for callers that only care about stack entries. New code
// should use StackEntry directly. Inventory itself lives in ../inventory.
export type ItemStack = StackEntry;

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

// ---------- Runtime instance ids ----------

export interface RuntimeIdState {
  /** Shared sequence for runtime instances such as stage / battle / dungeon session / spawned actors. */
  nextSeq: number;
}

// ---------- Dungeon sessions ----------


export interface DungeonSavedCharState {
  locationId: string | null;
  stageId: string | null;
  activity: CharacterActivityState | null;
}

export type DungeonSessionPhase =

  | "spawningWave"
  | "fighting"
  | "waveCleared"
  | "waveResting"
  | "completed"
  | "failed"
  | "abandoned";

export interface DungeonSession {
  dungeonId: string;
  /** Character ids participating in this dungeon run. */
  partyCharIds: string[];
  /** Snapshot of each character's state before entering. Used to restore on exit. */
  savedActivities: Record<string, DungeonSavedCharState>;
  /** Current wave index (0-based) into the DungeonDef.waves array. */
  currentWaveIndex: number;
  /** Overall dungeon run status. */
  status: "in_progress" | "completed" | "failed" | "abandoned";
  /** Current runtime phase for save / UI / rehydrate. */
  phase: DungeonSessionPhase;
  /** Tick at which the current phase started. */
  transitionTick: number;
  startedAtTick: number;

  /** The shared stage instance id for this dungeon run. */
  stageId: string;
}

// ---------- WorldRecord (cross-run permanent progress) ----------
//
// Stored alongside GameState but semantically separate: WorldRecord survives
// only when explicitly preserved (currently clearSaveAndReset resets it too,
// but the interface is ready for a prestige / account-level save split).
//
// Persisted fields: upgrades only. Derived modifier lists are rebuilt by
// computeWorldModifiers in the worldrecord module; they are never stored here.

export interface WorldRecord {
  /** upgradeId → current level (0 = not yet purchased). */
  upgrades: Record<string, number>;
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
  /** Shared allocator state for runtime instance ids. Persisted so load/reset
   *  paths keep minting from one source of truth instead of reconstructing
   *  per-module counters. */
  runtimeIds: RuntimeIdState;
  /**
   * All world actors (PlayerCharacter + Enemy + future kinds).
   * Source of truth. Battles reference participants by id; they do NOT
   * contain copies of the actors they fight with.
   */
  actors: Actor[];
  /** Active battles indexed by id. Battle is plain data so it round-trips
   *  through the save file. Activities reference battles by id. */
  battles: Battle[];
  /** All active stage instances, keyed by stageId. Each PlayerCharacter
   *  references its current stage via `hero.stageId`. Multiple characters
   *  may reference the same stageId (future: co-op). */
  stages: Record<string, StageSession>;
  /** Active dungeon sessions, keyed by dungeonSessionId. */
  dungeons: Record<string, DungeonSession>;
  /** Which character the UI is currently focused on. Persisted for reload. */
  focusedCharId: string;
  /** Inventories keyed by charId OR the literal "shared" key. Fixed-capacity
   *  grid: each Inventory has a `capacity` and a dense `slots` array whose
   *  indices are stable across mutations (null = empty). See
   *  ../inventory/types.ts. */
  inventories: Record<string, Inventory>;
  /** Shared inventory stack limit. null means unlimited stacking. */
  sharedInventoryStackLimit: number | null;
  worldActivities: WorldActivityState[];
  /** Recent player-facing log history. Fixed-size tail buffer. */
  gameLog: GameLogEntry[];
  /** Generic counters / unlock flags / quest progress. */
  flags: Record<string, number>;
  /** Accumulated currencies (gold, gems, …). key = currency id string.
   *  Part of the per-run save; reset on clearSaveAndReset. */
  currencies: Record<string, number>;
  /** Permanent global upgrade state. Rebuilt into character attrs via
   *  computeWorldModifiers + rebuildCharacterDerived on load / purchase. */
  worldRecord: WorldRecord;
  settings: GameSettings;
  /** Wall-clock timestamp (ms since epoch) of the last save / snapshot.
   *  Used by the catch-up system to compute offline elapsed time. */
  lastWallClockMs: number;
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
    runtimeIds: { nextSeq: 0 },
    actors: [],
    battles: [],
    stages: {},
    dungeons: {},
    focusedCharId: "",
    inventories: {
      [SHARED_INVENTORY_KEY]: createInventory(DEFAULT_SHARED_INVENTORY_CAPACITY),
    },
    sharedInventoryStackLimit: DEFAULT_SHARED_STACK_LIMIT,
    worldActivities: [],
    gameLog: [],
    flags: {},
    currencies: {},
    worldRecord: { upgrades: {} },
    settings: { speedMultiplier: 1 },
    lastWallClockMs: Date.now(),
  };
}
