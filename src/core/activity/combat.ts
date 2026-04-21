// CombatActivity — player "I am actively fighting in the current stage".
//
// This is strictly the ACTIVITY layer: it drives battle ticks, handles
// hero KO recovery, and issues stop cleanup. The ACTOR POPULATION of the
// stage (spawning and respawning waves of enemies) is the StageController's
// job — CombatActivity just looks at the world and fights whatever enemies
// are currently in the current stage.
//
// State machine:
//
//   waitingForEnemies — no enemies alive in the current stage. The stage
//                       controller will respawn them; we idle until it does.
//     | enemies appear -> fighting
//     | stopRequested   -> stopped
//   fighting          — a Battle is active; delegate ticks to tickBattle.
//     | battle ends players_won -> waitingForEnemies
//     | battle ends enemies_won -> recovering
//     | stopRequested (and battle ends) -> stopped
//   recovering        — hero KO'd. Regen HP per tick until full.
//     | hero full-hp -> waitingForEnemies
//     | stopRequested (at full-hp) -> stopped
//   stopped           — terminal.
//
// Kill rewards flow via the bus — CombatActivity subscribes to 'kill' for
// enemies in its current battle and hands the hero an instant reward
// Effect per kill. See onParticipantKilled below.
//
// Save/load: persisted in PlayerCharacter.activity.data = { phase,
// currentBattleId, lastTransitionTick }. The stage the player is in is
// persisted separately on GameState.currentStage; the activity does not
// own stage state.

import {
  getAttr,
  isEnemy,
  isPlayer,
  type Character,
  type Enemy,
  type PlayerCharacter,
} from "../actor";
import { ATTR } from "../attribute";
import { getMonster } from "../content/registry";
import type { GameState } from "../state/types";
import {
  createBattle,
  tickBattle,
  type Battle,
  type TickBattleContext,
} from "../combat";
import { INTENT } from "../intent";
import { applyEffect, type EffectContext } from "../effect";
import { stageEnemies } from "../stage";
import type { CharacterActivity, ActivityContext } from "./types";

export const ACTIVITY_COMBAT_KIND = "activity.combat";

export interface CombatActivityOptions {
  ownerCharacterId: string;
  ctxProvider: () => ActivityContext;
  /** HP regen per tick during `recovering`, in [0, 1]. Default 0.01. */
  recoverHpPctPerTick?: number;
  /** actionDelayTicks passed to each Battle. Default 8 (0.8s per turn). */
  actionDelayTicks?: number;
  /** Pre-set initial state for load-from-save. */
  resume?: {
    phase: CombatActivityPhase;
    currentBattleId: string | null;
    lastTransitionTick: number;
  };
}

export type CombatActivityPhase =
  | "waitingForEnemies"
  | "fighting"
  | "recovering"
  | "stopped";

export interface CombatActivity extends CharacterActivity {
  readonly kind: typeof ACTIVITY_COMBAT_KIND;
  phase: CombatActivityPhase;
  currentBattleId: string | null;
  /** Tick at which the last phase transition happened. */
  lastTransitionTick: number;
  stopRequested: boolean;
}

// ---------- Factory ----------

export function createCombatActivity(
  opts: CombatActivityOptions,
): CombatActivity {
  const recoverHp = opts.recoverHpPctPerTick ?? 0.01;
  const actionDelay = opts.actionDelayTicks ?? 8;

  const initialCtx = opts.ctxProvider();
  const resume = opts.resume;

  const activity: CombatActivity = {
    id: `combat:${opts.ownerCharacterId}`,
    kind: ACTIVITY_COMBAT_KIND,
    startedAtTick: initialCtx.currentTick,
    ownerCharacterId: opts.ownerCharacterId,
    phase: resume?.phase ?? "waitingForEnemies",
    currentBattleId: resume?.currentBattleId ?? null,
    lastTransitionTick: resume?.lastTransitionTick ?? initialCtx.currentTick,
    stopRequested: false,

    tick() {
      const ctx = opts.ctxProvider();
      stepPhase(activity, ctx, { recoverHpPctPerTick: recoverHp, actionDelayTicks: actionDelay });
    },

    isDone() {
      return activity.phase === "stopped";
    },
  };

  // Kill-event subscription for reward granting. Torn down in enterStopped.
  const disposeKill = initialCtx.bus.on("kill", (payload) => {
    if (activity.phase === "stopped") return;
    onParticipantKilled(activity, payload.victimId, opts.ctxProvider());
  });
  (activity as unknown as { __disposeKill: () => void }).__disposeKill = disposeKill;

  return activity;
}

// ---------- State machine ----------

interface StepParams {
  recoverHpPctPerTick: number;
  actionDelayTicks: number;
}

function stepPhase(
  activity: CombatActivity,
  ctx: ActivityContext,
  params: StepParams,
): void {
  switch (activity.phase) {
    case "waitingForEnemies":
      stepWaiting(activity, ctx, params);
      return;
    case "fighting":
      stepFighting(activity, ctx, params);
      return;
    case "recovering":
      stepRecovering(activity, ctx, params);
      return;
    case "stopped":
      return;
  }
}

/** Poll the current stage for alive enemies. When any appear, open a battle
 *  against them. */
function stepWaiting(
  activity: CombatActivity,
  ctx: ActivityContext,
  params: StepParams,
): void {
  if (activity.stopRequested) {
    enterStopped(activity, ctx);
    return;
  }
  const session = ctx.state.currentStage;
  if (!session) return;
  const enemies = stageEnemies(session, ctx.state).filter((e) => e.currentHp > 0);
  if (enemies.length === 0) return;

  const hero = findHero(activity, ctx.state);
  if (!hero) return;

  openBattle(activity, hero, enemies, ctx, params);
}

function stepFighting(
  activity: CombatActivity,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const battle = lookupBattle(activity, ctx.state);
  if (!battle) {
    // Lost the battle reference somehow — fall back to waiting.
    activity.phase = "waitingForEnemies";
    activity.currentBattleId = null;
    return;
  }

  if (battle.outcome === "ongoing") {
    const bctx: TickBattleContext = {
      state: ctx.state,
      bus: ctx.bus,
      rng: ctx.rng,
      attrDefs: ctx.attrDefs,
      currentTick: ctx.currentTick,
    };
    tickBattle(battle, bctx);
  }

  if (battle.outcome === "ongoing") return;

  // Battle resolved. Dispose of the battle record; the stage controller
  // reclaims dead enemies on its own schedule.
  removeBattle(ctx.state, battle.id);

  const hero = findHero(activity, ctx.state);
  activity.currentBattleId = null;
  activity.lastTransitionTick = ctx.currentTick;

  if (activity.stopRequested) {
    enterStopped(activity, ctx);
    return;
  }
  if (!hero || hero.currentHp <= 0) {
    activity.phase = "recovering";
  } else {
    activity.phase = "waitingForEnemies";
  }
}

function stepRecovering(
  activity: CombatActivity,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const hero = findHero(activity, ctx.state);
  if (!hero) {
    enterStopped(activity, ctx);
    return;
  }
  const maxHp = getAttr(hero, ATTR.MAX_HP, ctx.attrDefs);
  if (maxHp <= 0) {
    enterStopped(activity, ctx);
    return;
  }
  const per = Math.max(1, Math.floor(maxHp * params.recoverHpPctPerTick));
  hero.currentHp = Math.min(maxHp, hero.currentHp + per);

  if (hero.currentHp >= maxHp) {
    if (activity.stopRequested) {
      enterStopped(activity, ctx);
      return;
    }
    activity.phase = "waitingForEnemies";
    activity.lastTransitionTick = ctx.currentTick;
  }
}

// ---------- Battle setup ----------

function openBattle(
  activity: CombatActivity,
  hero: PlayerCharacter,
  enemies: Enemy[],
  ctx: ActivityContext,
  params: StepParams,
): void {
  const session = ctx.state.currentStage!;
  const intents: Record<string, string> = {};
  intents[hero.id] = INTENT.RANDOM_ATTACK;
  for (const e of enemies) intents[e.id] = INTENT.RANDOM_ATTACK;

  const battleId =
    `battle.${activity.id}.${session.stageId}.w${session.combatWaveIndex}`;
  const battle = createBattle({
    id: battleId,
    mode: "solo",
    participantIds: [hero.id, ...enemies.map((e) => e.id)],
    actionDelayTicks: params.actionDelayTicks,
    startedAtTick: ctx.currentTick,
    intents,
  });
  ctx.state.battles.push(battle);
  activity.currentBattleId = battle.id;
  activity.phase = "fighting";
  activity.lastTransitionTick = ctx.currentTick;
}

function removeBattle(state: GameState, battleId: string): void {
  state.battles = state.battles.filter((b) => b.id !== battleId);
}

// ---------- Kill rewards ----------

function onParticipantKilled(
  activity: CombatActivity,
  victimId: string,
  ctx: ActivityContext,
): void {
  const battle = lookupBattle(activity, ctx.state);
  if (!battle) return;
  if (!battle.participantIds.includes(victimId)) return;

  const victim = ctx.state.actors.find((a) => a.id === victimId) as
    | Character
    | undefined;
  if (!victim || !isEnemy(victim)) return;

  const hero = findHero(activity, ctx.state);
  if (!hero) return;

  const enemy = victim as Enemy;
  const def = getMonster(enemy.defId);
  const xpReward = def.xpReward;

  // Build a runtime reward effect combining XP and currency. Skip entirely if
  // neither is available to avoid a no-op applyEffect call.
  const hasXp = xpReward > 0;
  const hasCurrency =
    def.currencyReward && Object.keys(def.currencyReward).length > 0;
  if (!hasXp && !hasCurrency) return;

  const rewardEffect = {
    id: `effect.runtime.kill_reward.${enemy.defId}` as never,
    kind: "instant" as const,
    rewards: {
      charXp: hasXp ? xpReward : undefined,
      currencies: hasCurrency ? def.currencyReward : undefined,
    },
  };

  const ectx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
  };
  applyEffect(rewardEffect, victim, hero, ectx);
}

// ---------- Helpers ----------

function findHero(
  activity: CombatActivity,
  state: GameState,
): PlayerCharacter | null {
  const a = state.actors.find((x) => x.id === activity.ownerCharacterId);
  if (!a || !isPlayer(a)) return null;
  return a;
}

function lookupBattle(
  activity: CombatActivity,
  state: GameState,
): Battle | null {
  if (!activity.currentBattleId) return null;
  return state.battles.find((b) => b.id === activity.currentBattleId) ?? null;
}

function enterStopped(activity: CombatActivity, ctx: ActivityContext): void {
  activity.phase = "stopped";
  activity.currentBattleId = null;
  const hero = findHero(activity, ctx.state);
  if (hero) hero.activity = null;
  const dispose = (activity as unknown as { __disposeKill?: () => void })
    .__disposeKill;
  if (dispose) dispose();
  ctx.bus.emit("activityComplete", {
    charId: activity.ownerCharacterId,
    kind: ACTIVITY_COMBAT_KIND,
  });
}
