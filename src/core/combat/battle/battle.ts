// Battle state + tick loop.
//
// Design notes:
// - Battle holds IDs, not actor refs. Actors live in GameState.actors. Battle
//   resolves them on demand each tick so mutations elsewhere flow naturally.
// - Battle advances on logic TICKS. Each tick the scheduler charges ATB energy,
//   then the battle serves every ready actor in descending energy order until no
//   one remains above threshold.
// - Battle is a Tickable. Its isDone() fires once outcome != "ongoing" so the
//   tick engine auto-unregisters it.
// - processActionEffects is run once PER ACTOR ACTION WINDOW (not per engine tick).
//   This intentionally preserves the current owner-turn decay model even under
//   ATB, keeping the blast radius limited while the scheduler is replaced.

import type { AttrDef } from "../../content/types";

/** Battle mode: solo (1 player) or party (future multi-character). */
export type BattleMode = "solo" | "party";
import { getTalent } from "../../content/registry";
import type { GameEventBus } from "../../infra/events";
import type { Rng } from "../../infra/rng";
import type { GameState } from "../../infra/state/types";
import type { Character } from "../../entity/actor";
import { isAlive, isCharacter, isEnemy, isPlayer } from "../../entity/actor";
import { applyTickResourceRegen } from "../../entity/resource";
import { tryUseTalent, type CastResult } from "../../behavior/ability";

import { processActionEffects } from "../../behavior/effect";
import {
  createSchedulerForMode,
  DEFAULT_BATTLE_SCHEDULER_MODE,
  nextActor as schedulerNextActor,
  onActionResolved as schedulerOnActionResolved,
  tickScheduler,
  type SchedulerContext,
  type SchedulerState,
} from "./scheduler";

import { resolveIntent, type IntentAction } from "../intent";


// ---------- Types ----------

export type BattleOutcome = "ongoing" | "players_won" | "enemies_won" | "draw";

export interface BattleMetadata {
  stageId?: string;
  locationId?: string;
  dungeonSessionId?: string;
  dungeonId?: string;
  combatZoneId?: string;
  waveId?: string;
  waveIndex?: number;
  partyCharIds?: string[];
}

export interface Battle {
  id: string;
  mode: BattleMode;
  /** All actors involved. IDs only — resolved against GameState.actors. */
  participantIds: string[];
  scheduler: SchedulerState;
  outcome: BattleOutcome;
  /** Structured metadata mirrored by the activity layer for global log emission. */
  metadata?: BattleMetadata;
  /** Per-actor intent id. Looked up in the intent registry at dispatch time.
   *  Every participant must be declared explicitly; Battle does not inject
   *  implicit defaults. */
  intents: Record<string, string>;
  /** Tick at which the battle started. */
  startedAtTick: number;
  /** Tick at which the battle ended (set once outcome != "ongoing"). */
  endedAtTick: number | null;
  /** Internal: ids already reported as dead, so we don't double-emit kill
   *  events or let the activity layer double-grant rewards. Plain object keeps
   *  Battle JSON-serializable inside GameState while making membership O(1). */
  deathsReported: Record<string, true>;
}

export interface CreateBattleOptions {
  id: string;
  mode: BattleMode;
  participantIds: string[];
  scheduler?: SchedulerState;
  intents: Record<string, string>;
  startedAtTick: number;
  metadata?: BattleMetadata;
}


const MAX_ACTIONS_PER_TICK_FACTOR = 32;

/**
 * Validate creation-time invariants for a Battle.
 *
 * Alpha stage policy is to fail loudly on bad combat setup instead of trying to
 * recover later inside the tick loop.
 */
function assertCreateBattleOptions(opts: CreateBattleOptions): void {

  if (opts.participantIds.length === 0) {
    throw new Error(`battle ${opts.id}: participantIds must not be empty`);
  }

  const seen = new Set<string>();
  for (const actorId of opts.participantIds) {
    if (seen.has(actorId)) {
      throw new Error(`battle ${opts.id}: duplicate participant "${actorId}"`);
    }
    seen.add(actorId);

    if (!opts.intents[actorId]) {
      throw new Error(
        `battle ${opts.id}: no intent registered for participant "${actorId}"`,
      );
    }
  }
}


/**
 * Create a save-safe Battle state object.
 *
 * The battle stores only plain data: participant ids, scheduler state,
 * and structured metadata. Player-facing logs are handled by the global
 * game-log system via bus events.
 */
export function createBattle(opts: CreateBattleOptions): Battle {

  assertCreateBattleOptions(opts);

  return {

    id: opts.id,
    mode: opts.mode,
    participantIds: opts.participantIds.slice(),
    scheduler: opts.scheduler ?? createSchedulerForMode(DEFAULT_BATTLE_SCHEDULER_MODE),
    outcome: "ongoing",

    metadata: opts.metadata
      ? {
          ...opts.metadata,
          partyCharIds: opts.metadata.partyCharIds?.slice(),
        }
      : undefined,
    intents: { ...opts.intents },

    startedAtTick: opts.startedAtTick,
    endedAtTick: null,
    deathsReported: {},
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

  let participants = resolveParticipants(battle, ctx.state);
  for (const participant of participants) {
    applyTickResourceRegen(participant, ctx.attrDefs);
  }
  emitNewDeaths(battle, participants, ctx);
  maybeTerminate(battle, participants, ctx);

  if (battle.outcome !== "ongoing") return;

  const schedCtx: SchedulerContext = { attrDefs: ctx.attrDefs };
  tickScheduler(battle.scheduler, participants, schedCtx);

  const maxActionsThisTick = Math.max(
    1,
    participants.length * MAX_ACTIONS_PER_TICK_FACTOR,
  );
  let actionsServed = 0;

  while (battle.outcome === "ongoing") {
    const actor = schedulerNextActor(battle.scheduler, participants, schedCtx);
    if (!actor) return;

    actionsServed += 1;
    if (actionsServed > maxActionsThisTick) {
      throw new Error(
        `battle ${battle.id}: exceeded ${maxActionsThisTick} action windows in one tick`,
      );
    }

    runActorActionWindow(battle, actor, participants, ctx);
    participants = resolveParticipants(battle, ctx.state);
    emitNewDeaths(battle, participants, ctx);
    maybeTerminate(battle, participants, ctx);
  }
}

interface PlannedAction extends IntentAction {
  energyCost: number;
}

function runActorActionWindow(
  battle: Battle,
  actor: Character,
  participants: readonly Character[],
  ctx: TickBattleContext,
): void {
  const defaultEnergyCost = getDefaultEnergyCost(battle.scheduler);

  processPreActionEffects(actor, ctx);
  if (consumeWindowIfActorDied(battle, actor, defaultEnergyCost)) {
    return;
  }

  const plannedAction = resolvePlannedAction(
    battle,
    actor,
    participants,
    ctx,
    defaultEnergyCost,
  );
  if (!plannedAction) {
    schedulerOnActionResolved(battle.scheduler, actor, defaultEnergyCost);
    emitSkippedAction(battle, actor, "no valid plan", ctx);
    decrementCooldowns(actor);
    return;
  }

  schedulerOnActionResolved(battle.scheduler, actor, plannedAction.energyCost);
  const result = executePlannedAction(
    battle,
    actor,
    plannedAction,
    participants,
    ctx,
  );
  emitPlannedActionResult(battle, actor, result, ctx);


  // Decrement all cooldowns by 1 after the actor's action resolves.
  decrementCooldowns(actor);
}

function processPreActionEffects(
  actor: Character,
  ctx: TickBattleContext,
): void {
  // Active effects still decay on the owner's own action window.
  processActionEffects(actor, {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
  });
}

function consumeWindowIfActorDied(
  battle: Battle,
  actor: Character,
  defaultEnergyCost: number,
): boolean {
  // If the actor died before acting (e.g. its own DoT tick), still consume the
  // served action window so the same ready slot cannot loop forever this tick.
  if (!isAlive(actor)) {
    schedulerOnActionResolved(battle.scheduler, actor, defaultEnergyCost);
    decrementCooldowns(actor);
    return true;
  }
  return false;
}

/**
 * Resolve the actor's intent for this window and attach the validated energy
 * cost of the chosen talent. Returns null when the actor has nothing valid to
 * do this window.
 */
function resolvePlannedAction(
  battle: Battle,
  actor: Character,
  participants: readonly Character[],
  ctx: TickBattleContext,
  defaultEnergyCost: number,
): PlannedAction | null {

  // Decide intent → validate + dispatch.
  const intentId = battle.intents[actor.id];
  if (!intentId) {
    throw new Error(`battle: no intent registered for actor "${actor.id}"`);
  }
  const intent = resolveIntent(intentId);
  const plan = intent(actor, { ...ctx, participants });
  if (!plan) return null;

  const talent = getTalent(plan.talentId);
  const activeParams = talent.getActiveParams?.(1);
  const energyCost = activeParams?.energyCost ?? defaultEnergyCost;
  if (!Number.isFinite(energyCost) || energyCost <= 0) {
    throw new Error(
      `battle: invalid energyCost ${energyCost} on talent ${talent.id}`,
    );
  }

  return {
    ...plan,
    energyCost,
  };
}

function executePlannedAction(
  battle: Battle,
  actor: Character,
  plannedAction: PlannedAction,
  participants: readonly Character[],
  ctx: TickBattleContext,
): CastResult {
  // Announce intention before effects resolve, so the game log reads
  // "X uses Y → X deals N damage" in the correct order.
  ctx.bus.emit("battleActionStarted", {
    battleId: battle.id,
    actorId: actor.id,
    targetIds: plannedAction.targets.map((t) => t.id),
    abilityId: plannedAction.talentId,
  });

  return tryUseTalent(actor, plannedAction.talentId, plannedAction.targets, {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
    participants,
  });
}

/**
 * Mirror the cast result into summary bus events.
 * Successful actions emit `battleActionResolved(action)`; failures become a
 * structured skip with the original target selection preserved.
 */
function emitPlannedActionResult(
  battle: Battle,
  actor: Character,
  result: CastResult,
  ctx: TickBattleContext,
): void {


  if (result.ok) {
    ctx.bus.emit("battleActionResolved", {
      battleId: battle.id,
      actorId: actor.id,
      abilityId: result.talentId,
      outcome: "action",
    });
    return;
  }

  // Cast failed (e.g. on cooldown, insufficient mp) — the action window was
  // already consumed above, so we only log the skip here.
  emitSkippedAction(battle, actor, result.reason, ctx);
}

function emitSkippedAction(
  battle: Battle,
  actor: Character,
  note: string,
  ctx: TickBattleContext,
): void {
  ctx.bus.emit("battleActionResolved", {
    battleId: battle.id,
    actorId: actor.id,
    abilityId: "",
    outcome: "skip",
    note,
  });
}


/** Decrement all positive cooldowns on an actor by 1 (one action elapsed). */
function decrementCooldowns(actor: Character): void {
  for (const id of Object.keys(actor.cooldowns)) {
    if (actor.cooldowns[id]! > 0) actor.cooldowns[id]!--;
  }
}

function getDefaultEnergyCost(state: SchedulerState): number {
  switch (state.kind) {
    case "atb":
      return state.actionThreshold;
    case "turn":
      // 回合制当前不消费 energyCost，但战斗计划阶段仍要求一个正数占位。
      return 1;
  }
}


// ---------- Termination ----------

/**
 * Recompute battle outcome from the current participant snapshot.
 * This runs both before scheduler advancement and after each served action.
 */
function maybeTerminate(

  battle: Battle,
  participants: readonly Character[],
  ctx: TickBattleContext,
): void {
  if (battle.outcome !== "ongoing") return;
  const livingPlayers = participants.filter((p) => isPlayer(p) && isAlive(p));
  const livingEnemies = participants.filter((p) => isEnemy(p) && isAlive(p));

  let outcome: BattleOutcome | null = null;
  if (livingPlayers.length === 0 && livingEnemies.length === 0) outcome = "draw";
  else if (livingPlayers.length === 0) outcome = "enemies_won";
  else if (livingEnemies.length === 0) outcome = "players_won";

  if (outcome !== null) {
    battle.outcome = outcome;
    battle.endedAtTick = ctx.currentTick;
    ctx.bus.emit("battleEnded", {
      battleId: battle.id,
      outcome,
    });
  }
}


/** Emit death events exactly once for every participant that has reached 0 HP. */
function emitNewDeaths(
  battle: Battle,
  participants: readonly Character[],
  ctx: TickBattleContext,
): void {

  for (const actor of participants) {
    if (!isAlive(actor) && !battle.deathsReported[actor.id]) {
      emitDeath(battle, actor, ctx);
    }
  }
}

function emitDeath(battle: Battle, victim: Character, ctx: TickBattleContext) {
  battle.deathsReported[victim.id] = true;
  ctx.bus.emit("battleActorDied", {
    battleId: battle.id,
    victimId: victim.id,
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

/**
 * Resolve participant ids against `GameState.actors` while preserving declared
 * battle order for deterministic scheduler tie-breaks.
 */
export function resolveParticipants(
  battle: Battle,
  state: GameState,
): Character[] {

  // The order returned MUST be stable across calls because the scheduler uses
  // participant array index as a deterministic tie-break. Preserve
  // participantIds order. Missing / wrong-kind actors are hard errors in alpha:
  // battles must not silently heal over bad setup or corrupted state.
  const byId = new Map(state.actors.map((actor) => [actor.id, actor] as const));
  const out: Character[] = [];
  for (const id of battle.participantIds) {
    const actor = byId.get(id);
    if (!actor) {
      throw new Error(
        `battle ${battle.id}: missing participant actor "${id}" in GameState`,
      );
    }
    if (!isCharacter(actor)) {
      throw new Error(
        `battle ${battle.id}: participant "${id}" is not a Character`,
      );
    }
    out.push(actor);
  }
  return out;
}

/**
 * Sanity check on participant talent references.
 * Useful in setup code to catch content typos before a battle starts ticking.
 */
export function assertTalentsResolvable(battle: Battle, state: GameState): void {

  const ps = resolveParticipants(battle, state);
  for (const p of ps) {
    for (const tid of p.knownTalentIds) {
      // Throws on unknown id.
      getTalent(tid);
    }
  }
}
