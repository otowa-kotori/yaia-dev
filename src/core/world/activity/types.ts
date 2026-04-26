// Activity lifecycle primitives.
//
// Two parallel lifecycles share a common shape:
//   CharacterActivity: owns a character slot; at most one per character.
//   WorldActivity: free-standing; many can run concurrently.
//
// Both are Tickables. Both serialize the minimal "resume info" to GameState
// (kind + startedAtTick + an opaque `data` payload) so a load-game can rebuild
// them. The runtime class holds only refs + transient counters; it is NOT
// persisted.

import type { AttrDef } from "../../content/types";
import type { BattleSchedulerMode } from "../../combat/battle";
import type { GameEventBus } from "../../infra/events";
import type { Rng } from "../../infra/rng";
import type { GameState } from "../../infra/state/types";
import type { Tickable } from "../../infra/tick";


export interface ActivityContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Readonly<Record<string, AttrDef>>;
  currentTick: number;
  /** Optional for backwards-compatible tests/helpers; runtime session always sets it. */
  battleSchedulerMode?: BattleSchedulerMode;
}



/** Common lifecycle. Both character and world activities implement this. */
export interface Activity extends Tickable {
  readonly kind: string;
  readonly startedAtTick: number;
  /** Called once when the activity is installed. Default no-op. */
  onStart?(ctx: ActivityContext): void;
  /** Called once when the activity finishes (success OR cancel). Default no-op. */
  onFinish?(ctx: ActivityContext): void;
  /** The hot path. Advance internal progress by one logic tick. */
  tick(): void;
  /** When true, tick engine auto-unregisters this activity. */
  isDone(): boolean;
}

/** Activity that belongs to a single character (one-at-a-time slot). */
export interface CharacterActivity extends Activity {
  readonly ownerCharacterId: string;
}

/** Activity that lives in the world, not on a character. */
export interface WorldActivity extends Activity {
  /** Stable id across saves (e.g. "crop.plot-1"). */
  readonly id: string;
}
