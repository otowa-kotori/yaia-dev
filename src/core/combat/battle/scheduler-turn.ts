import type { Character } from "../../entity/actor";
import { getAttr, isAlive } from "../../entity/actor";
import { ATTR } from "../../entity/attribute";

export const TURN_ACTION_SLOT_TICKS = 10;
export const DEFAULT_TURN_INTERVAL_TICKS = TURN_ACTION_SLOT_TICKS;

export interface TurnSchedulerState {
  kind: "turn";
  /** One actor acts every N logic ticks. */
  turnIntervalTicks: number;
  /** Countdown until the next action slot opens. 0 = ready now. */
  ticksUntilNextAction: number;
  /** Current round number, incremented when a new round snapshot is created. */
  round: number;
  /** Actors that were alive when this round started. New joiners wait until the
   *  next round; dead / removed participants are pruned out on sync. */
  roundEligibleActorIds: string[];
  /** Actors from the current round snapshot that have already spent their action
   *  window this round. This defines a round by “which living actors have
   *  acted”, not by a cached participant count. */
  roundActedActorIds: string[];
  /** Number of fully completed global rounds waiting to be observed by the
   *  battle loop (used by round-based natural resource regen). */
  completedRounds: number;
}

export interface CreateTurnSchedulerOptions {
  turnIntervalTicks?: number;
}

export function createTurnScheduler(
  opts: CreateTurnSchedulerOptions = {},
): TurnSchedulerState {
  const state: TurnSchedulerState = {
    kind: "turn",
    turnIntervalTicks: opts.turnIntervalTicks ?? DEFAULT_TURN_INTERVAL_TICKS,
    ticksUntilNextAction: 0,
    round: 0,
    roundEligibleActorIds: [],
    roundActedActorIds: [],
    completedRounds: 0,
  };

  assertTurnConfig(state);
  return state;
}

export function tickTurnScheduler(
  state: TurnSchedulerState,
  participants: readonly Character[],
): void {
  syncTurnRoundParticipants(state, participants);
  if (state.ticksUntilNextAction > 0) {
    state.ticksUntilNextAction -= 1;
  }
}

export function nextActorTurn(
  state: TurnSchedulerState,
  participants: readonly Character[],
): Character | null {
  syncTurnRoundParticipants(state, participants);
  if (state.ticksUntilNextAction > 0) return null;

  let actor = pickNextTurnActorFromCurrentRound(state, participants);
  if (actor) return actor;

  if (state.roundEligibleActorIds.length > 0) {
    state.completedRounds += 1;
  }

  if (!primeTurnRound(state, participants)) return null;
  actor = pickNextTurnActorFromCurrentRound(state, participants);
  if (!actor) {
    throw new Error("scheduler.turn: round was primed but no actor could be selected");
  }
  return actor;
}

export function onActionResolvedTurn(
  state: TurnSchedulerState,
  actor: Character,
  _energyCost?: number,
): void {
  if (!state.roundEligibleActorIds.includes(actor.id)) {
    throw new Error(
      `scheduler.turn: actor ${actor.id} resolved but is not part of the current round snapshot`,
    );
  }
  if (state.roundActedActorIds.includes(actor.id)) {
    throw new Error(
      `scheduler.turn: actor ${actor.id} resolved twice in the same round snapshot`,
    );
  }
  state.roundActedActorIds.push(actor.id);
  state.ticksUntilNextAction = state.turnIntervalTicks;
}

export function consumeCompletedTurnRounds(
  state: TurnSchedulerState,
): number {
  const completed = state.completedRounds;
  state.completedRounds = 0;
  return completed;
}

function syncTurnRoundParticipants(
  state: TurnSchedulerState,
  participants: readonly Character[],
): void {
  const liveIds = new Set(
    participants.filter((actor) => isAlive(actor)).map((actor) => actor.id),
  );
  state.roundEligibleActorIds = state.roundEligibleActorIds.filter((actorId) =>
    liveIds.has(actorId),
  );
  state.roundActedActorIds = state.roundActedActorIds.filter((actorId) =>
    liveIds.has(actorId),
  );
}

function primeTurnRound(
  state: TurnSchedulerState,
  participants: readonly Character[],
): boolean {
  const roundEligibleActorIds = participants
    .filter((actor) => isAlive(actor))
    .map((actor) => actor.id);
  state.roundEligibleActorIds = roundEligibleActorIds;
  state.roundActedActorIds = [];
  if (roundEligibleActorIds.length === 0) {
    return false;
  }
  state.round += 1;
  return true;
}

function pickNextTurnActorFromCurrentRound(
  state: TurnSchedulerState,
  participants: readonly Character[],
): Character | null {
  if (state.roundEligibleActorIds.length === 0) return null;

  const actedIds = new Set(state.roundActedActorIds);
  const participantsById = new Map(participants.map((actor) => [actor.id, actor] as const));
  const indexOf = buildParticipantOrderIndex(participants);

  const candidates = state.roundEligibleActorIds
    .filter((actorId) => !actedIds.has(actorId))
    .map((actorId) => participantsById.get(actorId))
    .filter((actor): actor is Character => actor !== undefined && isAlive(actor));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const speedDelta = getActorSpeed(right) - getActorSpeed(left);
    if (speedDelta !== 0) return speedDelta;
    return (indexOf.get(left.id) ?? Infinity) - (indexOf.get(right.id) ?? Infinity);
  });

  return candidates[0] ?? null;
}

function getActorSpeed(
  actor: Character,
): number {
  const speed = getAttr(actor, ATTR.SPEED);
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`scheduler.${actor.id}: invalid SPD ${speed} on actor ${actor.id}`);
  }
  return speed;
}

function buildParticipantOrderIndex(
  participants: readonly Character[],
): Map<string, number> {
  const indexOf = new Map<string, number>();
  for (let i = 0; i < participants.length; i++) {
    indexOf.set(participants[i]!.id, i);
  }
  return indexOf;
}

function assertTurnConfig(state: TurnSchedulerState): void {
  if (
    !Number.isInteger(state.turnIntervalTicks) ||
    state.turnIntervalTicks <= 0
  ) {
    throw new Error(
      `scheduler.turn: invalid turnIntervalTicks ${state.turnIntervalTicks}`,
    );
  }
}
