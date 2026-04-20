// Battle state + tick loop.
//
// Design notes:
// - Battle holds IDs, not actor refs. Actors live in GameState.actors. Battle
//   looks them up each tick, so hot-reloading or mutating actors elsewhere
//   flows naturally.
// - Battle advances on TICKS, not button presses. It accumulates
//   `ticksSinceLastAction`; when it crosses `actionDelayTicks` it requests the
//   next actor from the scheduler, runs that actor's intent, and dispatches
//   through tryUseAbility. This keeps pacing a pure data concern and makes
//   headless simulation identical to real-time play at speed 1x.
// - Battle is a Tickable. Its isDone() fires once outcome != "ongoing" so the
//   tick engine auto-unregisters it.
// - tickActiveEffects is run per-actor once PER ACTOR TURN (not per engine
//   tick). Duration-per-tick vs duration-per-turn is a design choice; turn-
//   based feels better with per-turn DoTs, and we can revisit for ATB.
//   Effects still measure durationTicks in logic ticks, but only decrement on
//   the owner's own turn. Document this in EffectDef authoring notes.

import type { AttrDef, StageMode } from "../content/types";
import { getAbility } from "../content/registry";
import type { GameEventBus } from "../events";
import type { Rng } from "../rng";
import type { GameState } from "../state/types";
import type { Character } from "../actor";
import { isAlive, isEnemy, isPlayer } from "../actor";
import { tryUseAbility, type CastResult } from "../ability";
import { tickActiveEffects } from "../effect";
import {
  createSpeedSortedScheduler,
  nextActor as schedulerNextActor,
  onActionResolved as schedulerOnActionResolved,
  type SchedulerContext,
  type SchedulerState,
} from "./scheduler";
import { INTENT, resolveIntent } from "../intent";

// ---------- Types ----------

export type BattleOutcome = "ongoing" | "players_won" | "enemies_won" | "draw";

export interface BattleLogEntry {
  tick: number;
  kind: "action" | "death" | "start" | "end" | "skip";
  actorId?: string;
  targetIds?: string[];
  abilityId?: string;
  magnitudes?: number[];
  note?: string;
}

export interface Battle {
  id: string;
  mode: StageMode;
  /** All actors involved. IDs only — resolved against GameState.actors. */
  participantIds: string[];
  scheduler: SchedulerState;
  /** Ticks accumulated since the last action resolved. */
  ticksSinceLastAction: number;
  /** Ticks of inaction before the next actor is served. Controls visible pacing. */
  actionDelayTicks: number;
  outcome: BattleOutcome;
  /** Ring-free append-only log. Callers trim when they ship logs to the UI. */
  log: BattleLogEntry[];
  /** Per-actor intent id. Looked up in the intent registry at dispatch time.
   *  Actors missing here fall back to INTENT.RANDOM_ATTACK. */
  intents: Record<string, string>;
  /** Tick at which the battle started. */
  startedAtTick: number;
  /** Tick at which the battle ended (set once outcome != "ongoing"). */
  endedAtTick: number | null;
  /** Internal: ids already reported as dead, so we don't double-emit kill
   *  events or let the activity layer double-grant rewards. Plain array (not
   *  Set) to keep Battle JSON-serializable so it can live in GameState. */
  deathsReported: string[];
}

export interface CreateBattleOptions {
  id: string;
  mode: StageMode;
  participantIds: string[];
  scheduler?: SchedulerState;
  actionDelayTicks?: number;
  intents?: Record<string, string>;
  startedAtTick: number;
}

export function createBattle(opts: CreateBattleOptions): Battle {
  return {
    id: opts.id,
    mode: opts.mode,
    participantIds: opts.participantIds.slice(),
    scheduler: opts.scheduler ?? createSpeedSortedScheduler(),
    ticksSinceLastAction: 0,
    actionDelayTicks: opts.actionDelayTicks ?? 4, // default 400ms at 10Hz
    outcome: "ongoing",
    log: [
      {
        tick: opts.startedAtTick,
        kind: "start",
        note: `battle ${opts.id} started`,
      },
    ],
    intents: opts.intents ?? {},
    startedAtTick: opts.startedAtTick,
    endedAtTick: null,
    deathsReported: [],
  };
}

// ---------- Tick loop ----------

export interface TickBattleContext {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  attrDefs: Readonly<Record<string, AttrDef>>;
  currentTick: number;
}

/**
 * Advance a battle by exactly one logic tick. Meant to be called from a
 * CombatActivity that the TickEngine owns. Does not mutate currentTick.
 */
export function tickBattle(battle: Battle, ctx: TickBattleContext): void {
  if (battle.outcome !== "ongoing") return;

  battle.ticksSinceLastAction += 1;
  if (battle.ticksSinceLastAction < battle.actionDelayTicks) {
    // Wait for the pacing window to close before serving another action.
    // Check outcome anyway in case somebody died from a DoT between turns.
    maybeTerminate(battle, ctx);
    return;
  }

  // Time to act.
  battle.ticksSinceLastAction = 0;

  const participants = resolveParticipants(battle, ctx.state);
  const schedCtx: SchedulerContext = { attrDefs: ctx.attrDefs };
  const actor = schedulerNextActor(battle.scheduler, participants, schedCtx);

  if (!actor) {
    // No one can act — terminate in whatever state we're in.
    maybeTerminate(battle, ctx);
    return;
  }

  // Active effects tick down on the acting actor's own turn. See module doc.
  tickActiveEffects(actor, {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
  });

  // Actor may have died from a DoT pulse applied above.
  if (!isAlive(actor)) {
    emitDeath(battle, actor, ctx);
    maybeTerminate(battle, ctx);
    return;
  }

  // Decide intent → validate + dispatch.
  const intentId = battle.intents[actor.id] ?? INTENT.RANDOM_ATTACK;
  const intent = resolveIntent(intentId);
  const plan = intent(actor, { participants, rng: ctx.rng });

  if (!plan) {
    battle.log.push({
      tick: ctx.currentTick,
      kind: "skip",
      actorId: actor.id,
      note: "no valid plan",
    });
    schedulerOnActionResolved(battle.scheduler, actor);
    maybeTerminate(battle, ctx);
    return;
  }

  const result: CastResult = tryUseAbility(actor, plan.abilityId, plan.targets, {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
  });

  if (result.ok) {
    battle.log.push({
      tick: ctx.currentTick,
      kind: "action",
      actorId: actor.id,
      abilityId: result.abilityId,
      targetIds: result.targets.map((t) => t.id),
      magnitudes: result.magnitudes.slice(),
    });
  } else {
    // Cast failed (e.g. on cooldown, insufficient mp) — treat as a skipped turn.
    battle.log.push({
      tick: ctx.currentTick,
      kind: "skip",
      actorId: actor.id,
      abilityId: plan.abilityId,
      note: `cast failed: ${result.reason}`,
    });
  }

  // Emit deaths for any participant who died from this action.
  for (const p of participants) {
    if (!isAlive(p) && !battle.deathsReported.includes(p.id)) {
      emitDeath(battle, p, ctx);
    }
  }

  battle.scheduler && schedulerOnActionResolved(battle.scheduler, actor);
  maybeTerminate(battle, ctx);
}

// ---------- Termination ----------

function maybeTerminate(battle: Battle, ctx: TickBattleContext): void {
  if (battle.outcome !== "ongoing") return;
  const participants = resolveParticipants(battle, ctx.state);
  const livingPlayers = participants.filter((p) => isPlayer(p) && isAlive(p));
  const livingEnemies = participants.filter((p) => isEnemy(p) && isAlive(p));

  let outcome: BattleOutcome | null = null;
  if (livingPlayers.length === 0 && livingEnemies.length === 0) outcome = "draw";
  else if (livingPlayers.length === 0) outcome = "enemies_won";
  else if (livingEnemies.length === 0) outcome = "players_won";

  if (outcome !== null) {
    battle.outcome = outcome;
    battle.endedAtTick = ctx.currentTick;
    battle.log.push({
      tick: ctx.currentTick,
      kind: "end",
      note: `outcome: ${outcome}`,
    });
  }
}

function emitDeath(battle: Battle, victim: Character, ctx: TickBattleContext) {
  battle.deathsReported.push(victim.id);
  battle.log.push({
    tick: ctx.currentTick,
    kind: "death",
    actorId: victim.id,
  });
  // kill event: we don't always know who delivered the final blow cleanly
  // (AoE, DoT). Emit with attackerId = "" for now; callers that care can
  // correlate to the most recent `damage` event.
  //
  // Per-kill rewards are handled by listeners on the bus (e.g. the active
  // CombatActivity subscribes to 'kill' events and grants XP). Keeping this
  // out of Battle itself avoids non-serializable callbacks on the Battle
  // struct — Battle now lives in GameState and must be plain data.
  ctx.bus.emit("kill", { attackerId: "", victimId: victim.id });
}

// ---------- Resolution ----------

export function resolveParticipants(
  battle: Battle,
  state: GameState,
): Character[] {
  // The order returned MUST be stable across calls because the scheduler
  // uses participant array index as a tie-break. Preserve participantIds order.
  const byId = new Map<string, Character>();
  for (const a of state.actors) {
    // Only characters participate in battles (Actor root has no HP).
    // All current actor kinds are characters; narrow when more kinds appear.
    byId.set(a.id, a as Character);
  }
  const out: Character[] = [];
  for (const id of battle.participantIds) {
    const c = byId.get(id);
    if (c) out.push(c);
  }
  return out;
}

// Sanity check on ability references — catches typos at battle creation time
// rather than mid-combat. Optional; callers can skip.
export function assertAbilitiesResolvable(battle: Battle, state: GameState): void {
  const ps = resolveParticipants(battle, state);
  for (const p of ps) {
    for (const ab of p.abilities) {
      // Throws on unknown id.
      getAbility(ab);
    }
  }
}
