// ATB scheduler.
//
// The scheduler hides the per-tick energy bookkeeping behind a plain-data
// abstraction so Battle stays agnostic to the concrete initiative model.
// Current implementation: an FF-style ATB bar driven by SPD.
//
// JSON-safety: schedulers are plain DATA, not objects with method closures.
// A `SchedulerState` carries the live state; pure functions advance it.
// This keeps Battle save-friendly and deterministic.

import type { AttrDef } from "../../content/types";
import type { Character } from "../../entity/actor";
import { getAttr, isAlive } from "../../entity/actor";
import { ATTR } from "../../entity/attribute";

/** Input to scheduler dispatchers. The live mutable scheduler state is stored in
 *  the SchedulerState passed in. */
export interface SchedulerContext {
  attrDefs: Readonly<Record<string, AttrDef>>;
}

export const DEFAULT_ATB_ACTION_THRESHOLD = 1000;
export const DEFAULT_ATB_BASE_ENERGY_GAIN = 40;
/** Base SPD that maps 1:1 to baseEnergyGain. With baseSPD = 40 and
 *  baseEnergyGain = 40, energy gained per tick = exactly SPD.
 *  A unit with SPD 40 gains 40 energy/tick → acts every 25 ticks (2.5 s). */
export const DEFAULT_ATB_BASE_SPEED = 40;
/** Opening initiative: initialEnergy = SPD × this. Capped below threshold. */
export const DEFAULT_ATB_INITIAL_ENERGY_PER_SPEED = 12;

export interface AtbSchedulerState {
  kind: "atb";
  /** Current ATB energy by actor id. Plain object keeps the state JSON-safe. */
  energyByActorId: Record<string, number>;
  /** Post-action energy snapshot per actor. Used by UI to normalize the ATB
   *  gauge so that high-cost abilities don't create a "stuck at 0%" illusion.
   *  Set to min(0, energy) after each action; cleared when energy crosses
   *  back above 0 (i.e. floor is only relevant while energy is negative). */
  energyFloorByActorId: Record<string, number>;
  /** Energy required before an actor may act. */
  actionThreshold: number;
  /** Base energy gained each tick at baseSpeed. */
  baseEnergyGain: number;
  /** SPD value that maps to baseEnergyGain. */
  baseSpeed: number;
  /** Deterministic opening initiative bonus per point of SPD. */
  initialEnergyPerSpeed: number;
}

export type SchedulerState = AtbSchedulerState;

export interface CreateAtbSchedulerOptions {
  actionThreshold?: number;
  baseEnergyGain?: number;
  baseSpeed?: number;
  initialEnergyPerSpeed?: number;
}

export function createAtbScheduler(
  opts: CreateAtbSchedulerOptions = {},
): AtbSchedulerState {
  const state: AtbSchedulerState = {
    kind: "atb",
    energyByActorId: {},
    energyFloorByActorId: {},
    actionThreshold: opts.actionThreshold ?? DEFAULT_ATB_ACTION_THRESHOLD,
    baseEnergyGain: opts.baseEnergyGain ?? DEFAULT_ATB_BASE_ENERGY_GAIN,
    baseSpeed: opts.baseSpeed ?? DEFAULT_ATB_BASE_SPEED,
    initialEnergyPerSpeed:
      opts.initialEnergyPerSpeed ?? DEFAULT_ATB_INITIAL_ENERGY_PER_SPEED,
  };

  assertAtbConfig(state);
  return state;
}

/** Advance scheduler time by exactly one logic tick. */
export function tickScheduler(
  state: SchedulerState,
  participants: readonly Character[],
  ctx: SchedulerContext,
): void {
  switch (state.kind) {
    case "atb":
      tickAtbScheduler(state, participants, ctx);
      return;
  }
}

/** Return the next ready actor to act, or null if no one currently meets the
 *  ATB threshold. Does not consume energy by itself. */
export function nextActor(
  state: SchedulerState,
  participants: readonly Character[],
  ctx: SchedulerContext,
): Character | null {
  switch (state.kind) {
    case "atb":
      return nextActorAtb(state, participants, ctx);
  }
}

/** Consume ATB energy after one ready actor's action window has been served.
 *  Callers may pass a custom energyCost; omitted uses actionThreshold. */
export function onActionResolved(
  state: SchedulerState,
  actor: Character,
  energyCost?: number,
): void {
  switch (state.kind) {
    case "atb":
      onActionResolvedAtb(state, actor, energyCost);
      return;
  }
}

function tickAtbScheduler(
  state: AtbSchedulerState,
  participants: readonly Character[],
  ctx: SchedulerContext,
): void {
  syncParticipants(state, participants, ctx);
  for (const actor of participants) {
    if (!isAlive(actor)) continue;

    const currentEnergy = state.energyByActorId[actor.id];
    if (currentEnergy === undefined) {
      throw new Error(`scheduler.atb: missing energy for actor ${actor.id} after sync`);
    }

    const nextEnergy = currentEnergy + getEnergyGain(state, actor, ctx);
    state.energyByActorId[actor.id] = nextEnergy;

    // Clear floor once energy is back to non-negative — the post-action
    // recovery phase is over and the gauge denominator should revert to
    // the standard threshold.
    const floor = state.energyFloorByActorId[actor.id];
    if (floor !== undefined && floor < 0 && nextEnergy >= 0) {
      state.energyFloorByActorId[actor.id] = 0;
    }
  }
}


function nextActorAtb(
  state: AtbSchedulerState,
  participants: readonly Character[],
  ctx: SchedulerContext,
): Character | null {
  syncParticipants(state, participants, ctx);

  const indexOf = new Map<string, number>();
  for (let i = 0; i < participants.length; i++) {
    indexOf.set(participants[i]!.id, i);
  }

  let best: Character | null = null;
  let bestEnergy = -Infinity;
  let bestOrder = Infinity;

  for (const actor of participants) {
    if (!isAlive(actor)) continue;
    const energy = state.energyByActorId[actor.id] ?? 0;
    if (energy < state.actionThreshold) continue;

    const order = indexOf.get(actor.id) ?? Infinity;
    if (
      energy > bestEnergy ||
      (energy === bestEnergy && order < bestOrder)
    ) {
      best = actor;
      bestEnergy = energy;
      bestOrder = order;
    }
  }

  return best;
}

function onActionResolvedAtb(
  state: AtbSchedulerState,
  actor: Character,
  energyCost?: number,
): void {
  const cost = energyCost ?? state.actionThreshold;
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`scheduler.atb: invalid energyCost ${cost}`);
  }
  const after = (state.energyByActorId[actor.id] ?? 0) - cost;
  state.energyByActorId[actor.id] = after;
  // Record the post-action floor so UI can normalize the gauge.
  // Only meaningful when energy goes negative (high-cost abilities).
  state.energyFloorByActorId[actor.id] = Math.min(0, after);
}

function syncParticipants(
  state: AtbSchedulerState,
  participants: readonly Character[],
  ctx: SchedulerContext,
): void {
  const liveIds = new Set(participants.map((actor) => actor.id));
  for (const actorId of Object.keys(state.energyByActorId)) {
    if (!liveIds.has(actorId)) {
      delete state.energyByActorId[actorId];
      delete state.energyFloorByActorId[actorId];
    }
  }

  for (const actor of participants) {
    if (state.energyByActorId[actor.id] !== undefined) continue;
    state.energyByActorId[actor.id] = getInitialEnergy(state, actor, ctx);
    state.energyFloorByActorId[actor.id] = 0;
  }
}

function getInitialEnergy(
  state: AtbSchedulerState,
  actor: Character,
  ctx: SchedulerContext,
): number {
  const raw = getActorSpeed(actor, ctx) * state.initialEnergyPerSpeed;
  const capped = Math.min(state.actionThreshold - 1, raw);
  return Math.max(0, capped);
}

function getEnergyGain(
  state: AtbSchedulerState,
  actor: Character,
  ctx: SchedulerContext,
): number {
  const speed = getActorSpeed(actor, ctx);
  return state.baseEnergyGain * (speed / state.baseSpeed);
}

function getActorSpeed(
  actor: Character,
  ctx: SchedulerContext,
): number {
  const speed = getAttr(actor, ATTR.SPEED, ctx.attrDefs);
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`scheduler.atb: invalid SPD ${speed} on actor ${actor.id}`);
  }
  return speed;
}

function assertAtbConfig(state: AtbSchedulerState): void {
  if (!Number.isFinite(state.actionThreshold) || state.actionThreshold <= 0) {
    throw new Error(`scheduler.atb: invalid actionThreshold ${state.actionThreshold}`);
  }
  if (!Number.isFinite(state.baseEnergyGain) || state.baseEnergyGain <= 0) {
    throw new Error(`scheduler.atb: invalid baseEnergyGain ${state.baseEnergyGain}`);
  }
  if (!Number.isFinite(state.baseSpeed) || state.baseSpeed <= 0) {
    throw new Error(`scheduler.atb: invalid baseSpeed ${state.baseSpeed}`);
  }
  if (
    !Number.isFinite(state.initialEnergyPerSpeed) ||
    state.initialEnergyPerSpeed < 0
  ) {
    throw new Error(
      `scheduler.atb: invalid initialEnergyPerSpeed ${state.initialEnergyPerSpeed}`,
    );
  }
}

// ---------- UI helpers ----------

/** Normalized ATB gauge value in [0, 1] for display.
 *
 *  Uses a post-action energy floor so that high-cost abilities (energyCost >
 *  threshold) don't create a "stuck at 0%" illusion. Instead the bar
 *  immediately starts rising from 0%, just with a longer total distance to
 *  cover.
 *
 *  Formula:
 *    floor  = energyFloorByActorId[id] (≤ 0, recorded after each action)
 *    gauge  = (energy - floor) / (threshold - floor)
 *
 *  Example — fire bolt costs 1200, threshold 1000:
 *    energy after action = -200, floor = -200
 *    gauge = (-200 - (-200)) / (1000 - (-200)) = 0 / 1200 = 0%  (not stuck)
 *    next tick energy = -128, gauge = 72 / 1200 ≈ 6%  (moving!)
 */
export function getAtbGaugePct(
  state: SchedulerState,
  actorId: string,
): number {
  const energy = state.energyByActorId[actorId] ?? 0;
  const floor = state.energyFloorByActorId[actorId] ?? 0;
  const threshold = state.actionThreshold;
  const range = threshold - floor;
  if (range <= 0) return 0;
  return Math.max(0, Math.min(1, (energy - floor) / range));
}
