// Battle schedulers.
//
// The scheduler hides initiative bookkeeping behind a plain-data abstraction so
// Battle stays agnostic to the concrete turn model.
//
// Supported modes:
// - `atb`  — FF-style continuous energy bars driven by SPD
// - `turn` — one actor every fixed interval; remaining actors are re-sorted by
//            SPD after each action, while newly joined participants wait until
//            the next round
//
// JSON-safety: schedulers are plain DATA, not objects with method closures.
// A `SchedulerState` carries the live state; pure functions advance it.
// This keeps Battle save-friendly and deterministic.

import type { Character } from "../../entity/actor";
import {
  ATB_REFERENCE_SELF_TURN_TICKS,
  createAtbScheduler,
  getAtbGaugePct as getAtbGaugePctAtb,
  getAtbReferenceSelfTurnTicks as getAtbReferenceSelfTurnTicksAtb,
  nextActorAtb,
  onActionResolvedAtb,
  tickAtbScheduler,
  type AtbSchedulerState,
  type CreateAtbSchedulerOptions,
  DEFAULT_ATB_ACTION_THRESHOLD,
  DEFAULT_ATB_BASE_ENERGY_GAIN,
  DEFAULT_ATB_BASE_SPEED,
  DEFAULT_ATB_INITIAL_ENERGY_PER_SPEED,
} from "./scheduler-atb";
import {
  consumeCompletedTurnRounds,
  createTurnScheduler,
  nextActorTurn,
  onActionResolvedTurn,
  tickTurnScheduler,
  type CreateTurnSchedulerOptions,
  type TurnSchedulerState,
  DEFAULT_TURN_INTERVAL_TICKS,
  TURN_ACTION_SLOT_TICKS,
} from "./scheduler-turn";

export type BattleSchedulerMode = "atb" | "turn";

export const DEFAULT_BATTLE_SCHEDULER_MODE: BattleSchedulerMode = "turn";

export type SchedulerState = AtbSchedulerState | TurnSchedulerState;

export type {
  AtbSchedulerState,
  CreateAtbSchedulerOptions,
  TurnSchedulerState,
  CreateTurnSchedulerOptions,
};

export {
  ATB_REFERENCE_SELF_TURN_TICKS,
  DEFAULT_ATB_ACTION_THRESHOLD,
  DEFAULT_ATB_BASE_ENERGY_GAIN,
  DEFAULT_ATB_BASE_SPEED,
  DEFAULT_ATB_INITIAL_ENERGY_PER_SPEED,
  DEFAULT_TURN_INTERVAL_TICKS,
  TURN_ACTION_SLOT_TICKS,
  createAtbScheduler,
  createTurnScheduler,
};

export function createSchedulerForMode(
  mode: BattleSchedulerMode,
): SchedulerState {
  switch (mode) {
    case "atb":
      return createAtbScheduler();
    case "turn":
      return createTurnScheduler();
  }
}

/** Advance scheduler time by exactly one logic tick. */
export function tickScheduler(
  state: SchedulerState,
  participants: readonly Character[],
): void {
  switch (state.kind) {
    case "atb":
      tickAtbScheduler(state, participants);
      return;
    case "turn":
      tickTurnScheduler(state, participants);
      return;
  }
}

/** Return the next ready actor to act, or null if no one is currently ready. */
export function nextActor(
  state: SchedulerState,
  participants: readonly Character[],
): Character | null {
  switch (state.kind) {
    case "atb":
      return nextActorAtb(state, participants);
    case "turn":
      return nextActorTurn(state, participants);
  }
}

/** Consume scheduler progress after one ready actor's action window has been served.
 *  For ATB callers may pass a custom energyCost; turn mode ignores it. */
export function onActionResolved(
  state: SchedulerState,
  actor: Character,
  energyCost?: number,
): void {
  switch (state.kind) {
    case "atb":
      onActionResolvedAtb(state, actor, energyCost);
      return;
    case "turn":
      onActionResolvedTurn(state, actor, energyCost);
      return;
  }
}

/** Natural combat regen that should be applied every logic tick.
 *
 *  ATB has no global round boundary, so regen is smeared evenly across the
 *  reference self-turn duration. Turn mode grants regen on completed rounds via
 *  `consumeCompletedRounds()` instead, so the per-tick portion is 0. */
export function getPassiveBattleRegenScalePerTick(
  state: SchedulerState,
): number {
  switch (state.kind) {
    case "atb":
      return 1 / getAtbReferenceSelfTurnTicksAtb(state);
    case "turn":
      return 0;
  }
}

/** Completed global rounds waiting to be observed by the battle loop. */
export function consumeCompletedRounds(state: SchedulerState): number {
  switch (state.kind) {
    case "atb":
      return 0;
    case "turn":
      return consumeCompletedTurnRounds(state);
  }
}

export function getAtbReferenceSelfTurnTicks(
  state: SchedulerState,
): number {
  if (state.kind !== "atb") {
    throw new Error("scheduler.getAtbReferenceSelfTurnTicks: scheduler is not ATB");
  }
  return getAtbReferenceSelfTurnTicksAtb(state);
}

/** Normalized ATB gauge value in [0, 1] for display.
 *
 *  Uses a post-action energy floor so that high-cost abilities (energyCost >
 *  threshold) don't create a "stuck at 0%" illusion. Instead the bar
 *  immediately starts rising from 0%, just with a longer total distance to
 *  cover.
 */
export function getAtbGaugePct(
  state: SchedulerState,
  actorId: string,
): number {
  if (state.kind !== "atb") {
    throw new Error("scheduler.getAtbGaugePct: scheduler is not ATB");
  }
  return getAtbGaugePctAtb(state, actorId);
}
