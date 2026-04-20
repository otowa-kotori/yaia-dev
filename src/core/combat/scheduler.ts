// Turn scheduler.
//
// The scheduler hides the "who acts next" decision behind an abstraction so
// Combat itself is agnostic to turn-based vs ATB vs speed-weighted models.
// Default implementation: SpeedSortedScheduler — a classic JRPG "one action
// per unit per round, ordered by speed desc" model.
//
// Duration units throughout combat are ticks — scheduler does NOT expose a
// "round" concept externally. If it needs to reshuffle every round that's an
// internal detail.
//
// JSON-safety: schedulers are plain DATA, not objects with method closures.
// A `SchedulerState` carries the state; a pure function (dispatched by
// `kind`) advances it. This split lets Battle live inside GameState and
// round-trip through a save file.
//
// Adding a new scheduler kind:
//   1. Extend the SchedulerState union with a new shape.
//   2. Add a case in nextActor() below.
//
// No runtime registration table — switch-dispatch keeps the set of
// implementations visible at a glance. Upgrade to a registry when
// third-party mods need to add schedulers.

import type { AttrDef } from "../content/types";
import type { Character } from "../actor";
import { getAttr, isAlive } from "../actor";
import { ATTR } from "../attribute";

/** Input to scheduler dispatchers. Schedulers are stateless in their function
 *  interface; the live state lives in the SchedulerState passed in. */
export interface SchedulerContext {
  attrDefs: Readonly<Record<string, AttrDef>>;
}

// ---------- SpeedSortedScheduler ----------
//
// Classic JRPG ordering, re-evaluated on every call:
//   * nextActor picks, among alive participants who have NOT yet acted this
//     round, the one with the highest current Speed. Ties broken by
//     participant-list index for determinism.
//   * That actor is marked as having acted (stored in `actedThisRound`) and
//     returned.
//   * When every alive participant has acted, the round ends — `actedThisRound`
//     is cleared and the next call picks from the full alive set again.
//
// Re-evaluating each call (rather than freezing a per-round order) means a
// speed buff applied DURING a round takes effect on the very next action,
// not the next round. This matches player expectations for buffs like "next
// turn: +speed".

export interface SpeedSortedSchedulerState {
  kind: "speed_sorted";
  /** Actor ids that have already acted in the current round. Cleared when a
   *  round ends. */
  actedThisRound: string[];
}

export type SchedulerState = SpeedSortedSchedulerState;

export function createSpeedSortedScheduler(): SpeedSortedSchedulerState {
  return { kind: "speed_sorted", actedThisRound: [] };
}

/**
 * Return the next actor to act, or null if no one can currently act.
 * Mutates `state`. Dispatchers MUST skip dead participants.
 */
export function nextActor(
  state: SchedulerState,
  participants: readonly Character[],
  ctx: SchedulerContext,
): Character | null {
  switch (state.kind) {
    case "speed_sorted":
      return nextActorSpeedSorted(state, participants, ctx);
  }
}

/** Called after an action resolves, in case the scheduler wants to advance
 *  its internal pointer. For SpeedSortedScheduler this is a no-op because
 *  nextActor already marks the actor as acted before returning. Kept for
 *  symmetry with future ATB-style schedulers that bank progress per-actor. */
export function onActionResolved(
  _state: SchedulerState,
  _actor: Character,
): void {
  /* no-op */
}

// ---------- SpeedSorted impl ----------

function nextActorSpeedSorted(
  state: SpeedSortedSchedulerState,
  participants: readonly Character[],
  ctx: SchedulerContext,
): Character | null {
  // Step 1: drop acted-this-round ids that no longer correspond to alive
  // participants (e.g. actor died after acting — shouldn't affect logic, but
  // keeps the set tidy and avoids unbounded growth across reshuffles).
  {
    const aliveIds = new Set(participants.filter(isAlive).map((p) => p.id));
    if (state.actedThisRound.some((id) => !aliveIds.has(id))) {
      state.actedThisRound = state.actedThisRound.filter((id) => aliveIds.has(id));
    }
  }

  // Step 2: candidates = alive AND not yet acted.
  const acted = new Set(state.actedThisRound);
  let candidates = participants.filter((p) => isAlive(p) && !acted.has(p.id));

  // Round over — reset and try again with the full alive set.
  if (candidates.length === 0) {
    state.actedThisRound = [];
    candidates = participants.filter(isAlive);
    if (candidates.length === 0) return null;
  }

  // Step 3: pick the fastest, ties broken by participant-list index.
  // Build index map from the original participants order for stable tie-break.
  const indexOf = new Map<string, number>();
  for (let i = 0; i < participants.length; i++) {
    indexOf.set(participants[i]!.id, i);
  }

  let bestIdx = -1;
  let bestSpeed = -Infinity;
  let bestOrder = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const speed = getAttr(c, ATTR.SPEED, ctx.attrDefs);
    const order = indexOf.get(c.id) ?? i;
    if (
      speed > bestSpeed ||
      (speed === bestSpeed && order < bestOrder)
    ) {
      bestSpeed = speed;
      bestOrder = order;
      bestIdx = i;
    }
  }

  const chosen = candidates[bestIdx]!;
  state.actedThisRound.push(chosen.id);
  return chosen;
}
