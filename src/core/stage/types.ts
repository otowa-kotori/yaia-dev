// Stage session primitives.
//
// A Stage is a scene that owns a population of Actors (enemies, resource
// nodes). Stages do NOT run battles or gather loops — those belong to the
// Activity layer. A stage is responsible for:
//
//   - spawning its initial population on enter
//   - respawning elements over time according to its def (e.g. 20 ticks
//     after a wave is cleared, a new wave spawns)
//   - cleaning up its population on leave (so actors don't pile up in the
//     world forever)
//
// The player can be in at most one stage at a time: state.currentStage.
// Entering a new stage leaves the current one first.
//
// Stage state is JSON-safe (plain data) so it round-trips through saves.
// Runtime logic (the "controller") is not persisted; it's re-instantiated
// from state.currentStage on load.

/**
 * Per-session state stored in GameState.currentStage. Minimal bookkeeping
 * for respawn timers + tracking which actors belong to this stage so
 * leaveStage can clean up.
 */
export interface StageSession {
  stageId: string;
  enteredAtTick: number;
  /** Ids of actors spawned BY this stage (so we know what to clean up on
   *  leave). Actors that pre-date the stage, like the player character,
   *  are not in this list. */
  spawnedActorIds: string[];
  // ---------- Respawn bookkeeping ----------
  /** If > 0, number of ticks remaining until the next combat wave spawns.
   *  When a wave is cleared, the stage controller sets this to the stage's
   *  waveIntervalTicks. When it reaches 0, a new wave is spawned. */
  combatWaveCooldownTicks: number;
  /** Monotonically increasing wave counter. Used to build unique enemy ids. */
  combatWaveIndex: number;
}
