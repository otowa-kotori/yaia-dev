// Turn scheduler.
//
// The TurnScheduler interface hides the "who acts next" decision behind an
// abstraction so Combat itself is agnostic to turn-based vs ATB vs speed-
// weighted models. Default implementation: SpeedSortedScheduler — a classic
// JRPG "one action per unit per round, ordered by speed desc" model.
//
// Duration units throughout combat are ticks — scheduler does NOT expose a
// "round" concept externally. If it needs to reshuffle every round that's an
// internal detail.

import type { AttrDef } from "../content/types";
import type { Character } from "../actor";
import { getAttr, isAlive } from "../actor";

/** Input to scheduler. Scheduler is stateless in its interface; state lives
 *  in the object returned by createScheduler().  */
export interface SchedulerContext {
  attrDefs: Readonly<Record<string, AttrDef>>;
}

/** Live scheduler state. Implementations can extend this as needed. */
export interface TurnScheduler {
  readonly kind: string;
  /**
   * Return the next actor to act, or null if no one can currently act
   * (e.g. round boundary reached and battle already over). Implementations
   * MUST skip dead participants. May mutate internal state (e.g. advance the
   * current-round pointer).
   */
  nextActor(
    participants: readonly Character[],
    ctx: SchedulerContext,
  ): Character | null;

  /** Called after an action resolves, in case the scheduler wants to advance
   *  its internal pointer. For SpeedSortedScheduler this is a no-op because
   *  nextActor itself advances. */
  onActionResolved?(actor: Character): void;
}

// ---------- SpeedSortedScheduler ----------
//
// Classic JRPG ordering:
//   * At the start of each round, all alive participants are listed in
//     descending Speed order (ties broken by participant index for stability).
//   * nextActor walks that list in order, skipping corpses (participants who
//     died mid-round don't get to act).
//   * When the list is exhausted, a new round is built from the current
//     participant slice.
//
// The scheduler does not "own" the participant list; it's re-passed each
// call so the caller can add/remove units (e.g. summons) freely. Ordering
// is recomputed per round, so a speed buff that lands mid-round takes
// effect next round.

interface SpeedSortedState extends TurnScheduler {
  readonly kind: "speed_sorted";
  /** Ordered ids for the current round. */
  order: string[];
  /** Index into `order` of the next actor to serve. */
  cursor: number;
}

export function createSpeedSortedScheduler(): TurnScheduler {
  const state: SpeedSortedState = {
    kind: "speed_sorted",
    order: [],
    cursor: 0,
    nextActor(participants, ctx) {
      return nextActorSpeedSorted(state, participants, ctx);
    },
  };
  return state;
}

function nextActorSpeedSorted(
  state: SpeedSortedState,
  participants: readonly Character[],
  ctx: SchedulerContext,
): Character | null {
  const byId = new Map(participants.map((p) => [p.id, p]));

  // Walk the current round's remaining slots; skip dead / missing participants.
  while (state.cursor < state.order.length) {
    const id = state.order[state.cursor++]!;
    const p = byId.get(id);
    if (p && isAlive(p)) return p;
  }

  // Round ended. Build a new one from alive participants, sorted by speed desc.
  const alive = participants.filter(isAlive);
  if (alive.length === 0) return null;

  // Stable sort: annotate with original index so ties fall in participant order.
  const annotated = alive.map((c, i) => ({
    c,
    speed: getAttr(c, "attr.speed", ctx.attrDefs),
    i,
  }));
  annotated.sort((a, b) => {
    if (b.speed !== a.speed) return b.speed - a.speed;
    return a.i - b.i;
  });

  state.order = annotated.map((x) => x.c.id);
  state.cursor = 0;

  // Serve the head of the new round.
  return nextActorSpeedSorted(state, participants, ctx);
}
