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
import { tryUseTalent, type CastResult } from "../../behavior/ability";
import { processActionEffects } from "../../behavior/effect";
import {
  createAtbScheduler,
  nextActor as schedulerNextActor,
  onActionResolved as schedulerOnActionResolved,
  tickScheduler,
  type SchedulerContext,
  type SchedulerState,
} from "./scheduler";
import { resolveIntent, type IntentAction } from "../intent";


// ---------- Types ----------

export type BattleOutcome = "ongoing" | "players_won" | "enemies_won" | "draw";

export interface BattleLogEntry {
  tick: number;
  kind: "action" | "damage" | "death" | "start" | "end" | "skip";
  actorId?: string;
  targetIds?: string[];
  talentId?: string;
  amount?: number;
  note?: string;
}

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
  /** Ring-free append-only log. Callers trim when they ship logs to the UI. */
  log: BattleLogEntry[];
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
 * structured metadata and an internal timeline for debugging / UI mirroring.
 */
export function createBattle(opts: CreateBattleOptions): Battle {

  assertCreateBattleOptions(opts);

  return {

    id: opts.id,
    mode: opts.mode,
    participantIds: opts.participantIds.slice(),
    scheduler: opts.scheduler ?? createAtbScheduler(),
    outcome: "ongoing",
    log: [
      {
        tick: opts.startedAtTick,
        kind: "start",
        note: `battle ${opts.id} started`,
      },
    ],
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
    emitSkippedAction(battle, actor, [], "", undefined, "no valid plan", ctx);
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
  emitPlannedActionResult(battle, actor, plannedAction, result, ctx);

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
  // Subscribe to damage events so every hit (including multi-hit, AoE,
  // reaction counter-attacks) gets its own log entry.
  const damageUnsub = ctx.bus.on("damage", (ev) => {
    battle.log.push({
      tick: ctx.currentTick,
      kind: "damage",
      actorId: ev.attackerId,
      targetIds: [ev.targetId],
      amount: ev.amount,
    });
  });

  try {
    emitActionStarted(battle, actor, plannedAction, ctx);
    return tryUseTalent(actor, plannedAction.talentId, plannedAction.targets, {
      state: ctx.state,
      bus: ctx.bus,
      rng: ctx.rng,
      attrDefs: ctx.attrDefs,
      currentTick: ctx.currentTick,
      participants,
    });
  } finally {
    damageUnsub();
  }
}

/** Emit the pre-resolution summary event consumed by the global game log. */
function emitActionStarted(
  battle: Battle,
  actor: Character,
  plannedAction: PlannedAction,
  ctx: TickBattleContext,
): void {

  // Announce intention before effects resolve, so the game log reads
  // "X uses Y → X deals N damage" in the correct order.
  ctx.bus.emit("battleActionStarted", {
    battleId: battle.id,
    actorId: actor.id,
    targetIds: plannedAction.targets.map((target) => target.id),
    abilityId: plannedAction.talentId,
    ...battleEventScope(battle),
  });
}

/**
 * Mirror the cast result into battle log entries and summary bus events.
 * Successful actions emit `battleActionResolved(action)`; failures become a
 * structured skip with the original target selection preserved.
 */
function emitPlannedActionResult(
  battle: Battle,
  actor: Character,
  plannedAction: PlannedAction,
  result: CastResult,
  ctx: TickBattleContext,
): void {

  if (result.ok) {
    const targetIds = result.targets.map((target) => target.id);
    battle.log.push({
      tick: ctx.currentTick,
      kind: "action",
      actorId: actor.id,
      talentId: result.talentId,
      targetIds,
    });
    ctx.bus.emit("battleActionResolved", {
      battleId: battle.id,
      actorId: actor.id,
      targetIds,
      abilityId: result.talentId,
      outcome: "action",
      ...battleEventScope(battle),
    });
    return;
  }

  // Cast failed (e.g. on cooldown, insufficient mp) — the action window was
  // already consumed above, so we only log the skip here.
  emitSkippedAction(
    battle,
    actor,
    plannedAction.targets.map((target) => target.id),
    plannedAction.talentId,
    plannedAction.talentId,
    result.reason,
    ctx,
  );
}

function emitSkippedAction(
  battle: Battle,
  actor: Character,
  targetIds: string[],
  abilityId: string,
  talentId: string | undefined,
  note: string,
  ctx: TickBattleContext,
): void {
  battle.log.push({
    tick: ctx.currentTick,
    kind: "skip",
    actorId: actor.id,
    ...(talentId ? { talentId } : {}),
    note,
  });
  ctx.bus.emit("battleActionResolved", {
    battleId: battle.id,
    actorId: actor.id,
    targetIds,
    abilityId,
    outcome: "skip",
    note,
    ...battleEventScope(battle),
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
    battle.log.push({
      tick: ctx.currentTick,
      kind: "end",
      note: `outcome: ${outcome}`,
    });
    ctx.bus.emit("battleEnded", {
      battleId: battle.id,
      outcome,
      ...battleEventScope(battle),
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
  battle.log.push({
    tick: ctx.currentTick,
    kind: "death",
    actorId: victim.id,
  });
  ctx.bus.emit("battleActorDied", {
    battleId: battle.id,
    victimId: victim.id,
    ...battleEventScope(battle),
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

function battleEventScope(battle: Battle): {
  stageId?: string;
  locationId?: string;
  dungeonSessionId?: string;
} {
  return {
    stageId: battle.metadata?.stageId,
    locationId: battle.metadata?.locationId,
    dungeonSessionId: battle.metadata?.dungeonSessionId,
  };
}

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
