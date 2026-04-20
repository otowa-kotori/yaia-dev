// CombatActivity — continuous stage-grinding loop.
//
// State machine:
//
//   fighting    — a Battle is active; delegate ticks to tickBattle.
//     | battle outcome = players_won -> waveDelay
//     | battle outcome = enemies_won -> recovering (hero KO)
//     | stopRequested=true and outcome ends -> stopped
//   waveDelay   — all enemies cleared; wait stage.waveIntervalTicks.
//     | ticks elapsed -> fighting (spawn next wave)
//     | stopRequested=true -> stopped
//   recovering  — hero KO'd. Regen hp using recoverHpPctPerTick each tick.
//     | hero.currentHp >= maxHp -> fighting (spawn next wave)
//     | stopRequested=true once fully healed -> stopped
//   stopped     — terminal; tick engine auto-unregisters via isDone().
//
// Battle lifetime:
//   A fresh Battle instance is created per wave. The previous Battle's
//   deathsReported and log are discarded (we don't need them across waves).
//   The owner character is reused across waves; its currentHp / cooldowns /
//   activeEffects carry over. Enemies spawn on demand via createEnemy and
//   are pushed into GameState.actors. When a wave is cleared, defeated
//   enemies are removed from state.actors.

import {
  createEnemy,
  getAttr,
  isEnemy,
  isPlayer,
  type Character,
  type Enemy,
  type PlayerCharacter,
} from "../actor";
import type { AttrDef, StageDef } from "../content/types";
import { getMonster, getStage } from "../content/registry";
import type { GameEventBus } from "../events";
import type { Rng } from "../rng";
import type { GameState } from "../state/types";
import {
  createBattle,
  tickBattle,
  type Battle,
  type TickBattleContext,
} from "../combat";
import { applyEffect, type EffectContext } from "../effect";
import type { CharacterActivity, ActivityContext } from "./types";

export const ACTIVITY_COMBAT_KIND = "activity.combat";

export interface CombatActivityOptions {
  ownerCharacterId: string;
  stageId: string;
  ctxProvider: () => ActivityContext;
  /** HP regen per tick during `recovering`, in [0, 1]. Default 0.01 (= 1% of
   *  maxHp per tick → 100 ticks = 10s to full heal). */
  recoverHpPctPerTick?: number;
  /** Delay between waves, in logic ticks. Falls back to stage.waveIntervalTicks
   *  or 20 if neither is set. */
  waveIntervalTicks?: number;
  /** actionDelayTicks passed to each Battle. Default 8 (0.8s per turn). */
  actionDelayTicks?: number;
}

export type CombatActivityPhase =
  | "fighting"
  | "waveDelay"
  | "recovering"
  | "stopped";

export interface CombatActivity extends CharacterActivity {
  readonly kind: typeof ACTIVITY_COMBAT_KIND;
  readonly stageId: string;
  phase: CombatActivityPhase;
  currentBattle: Battle | null;
  /** Monotonically increasing wave counter; starts at 1 for the first wave. */
  waveIndex: number;
  /** Tick at which the last wave ended — used to time waveDelay / recovery. */
  lastTransitionTick: number;
  /** Set by UI to request a clean stop after current wave or recovery. */
  stopRequested: boolean;
}

// ---------- Factory ----------

export function createCombatActivity(opts: CombatActivityOptions): CombatActivity {
  const stage = getStage(opts.stageId); // throws if missing — catches typos early
  const recoverHp = opts.recoverHpPctPerTick ?? 0.01;
  const waveInterval =
    opts.waveIntervalTicks ?? stage.waveIntervalTicks ?? 20;
  const actionDelay = opts.actionDelayTicks ?? 8;

  const id = `combat:${opts.ownerCharacterId}:${opts.stageId}`;

  // Spawn first wave at start.
  const activity: CombatActivity = {
    id,
    kind: ACTIVITY_COMBAT_KIND,
    startedAtTick: opts.ctxProvider().currentTick,
    ownerCharacterId: opts.ownerCharacterId,
    stageId: opts.stageId,
    phase: "fighting",
    currentBattle: null,
    waveIndex: 0,
    lastTransitionTick: opts.ctxProvider().currentTick,
    stopRequested: false,

    tick() {
      const ctx = opts.ctxProvider();
      stepPhase(activity, stage, ctx, {
        recoverHpPctPerTick: recoverHp,
        waveIntervalTicks: waveInterval,
        actionDelayTicks: actionDelay,
      });
    },

    isDone() {
      return activity.phase === "stopped";
    },
  };

  // Spawn the first wave immediately so subscribers see a populated battle.
  {
    const ctx = opts.ctxProvider();
    spawnNextWave(activity, stage, ctx, {
      actionDelayTicks: actionDelay,
    });
  }

  return activity;
}

// ---------- State machine ----------

interface StepParams {
  recoverHpPctPerTick: number;
  waveIntervalTicks: number;
  actionDelayTicks: number;
}

function stepPhase(
  activity: CombatActivity,
  stage: StageDef,
  ctx: ActivityContext,
  params: StepParams,
): void {
  switch (activity.phase) {
    case "fighting":
      stepFighting(activity, stage, ctx, params);
      return;
    case "waveDelay":
      stepWaveDelay(activity, stage, ctx, params);
      return;
    case "recovering":
      stepRecovering(activity, stage, ctx, params);
      return;
    case "stopped":
      return;
  }
}

function stepFighting(
  activity: CombatActivity,
  stage: StageDef,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const battle = activity.currentBattle;
  if (!battle) {
    // Shouldn't happen — fighting without a battle means setup logic broke.
    enterStopped(activity, ctx);
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

  // Wave resolved. Clean up defeated enemies.
  removeDefeatedEnemies(battle, ctx.state);

  const hero = findHero(activity, ctx.state);
  activity.currentBattle = null;
  activity.lastTransitionTick = ctx.currentTick;

  if (activity.stopRequested) {
    enterStopped(activity, ctx);
    return;
  }

  if (!hero || hero.currentHp <= 0) {
    // Hero KO: start recovery.
    activity.phase = "recovering";
  } else {
    activity.phase = "waveDelay";
  }
}

function stepWaveDelay(
  activity: CombatActivity,
  stage: StageDef,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const elapsed = ctx.currentTick - activity.lastTransitionTick;
  if (elapsed < params.waveIntervalTicks) return;
  if (activity.stopRequested) {
    enterStopped(activity, ctx);
    return;
  }
  spawnNextWave(activity, stage, ctx, {
    actionDelayTicks: params.actionDelayTicks,
  });
}

function stepRecovering(
  activity: CombatActivity,
  stage: StageDef,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const hero = findHero(activity, ctx.state);
  if (!hero) {
    enterStopped(activity, ctx);
    return;
  }

  const maxHp = getAttr(hero, "attr.max_hp", ctx.attrDefs);
  if (maxHp <= 0) {
    enterStopped(activity, ctx);
    return;
  }

  // Regen: integer-accumulate so small-fractional amounts eventually heal.
  const per = Math.max(1, Math.floor(maxHp * params.recoverHpPctPerTick));
  hero.currentHp = Math.min(maxHp, hero.currentHp + per);

  if (hero.currentHp >= maxHp) {
    if (activity.stopRequested) {
      enterStopped(activity, ctx);
      return;
    }
    spawnNextWave(activity, stage, ctx, {
      actionDelayTicks: params.actionDelayTicks,
    });
  }
}

// ---------- Wave spawning ----------

interface SpawnParams {
  actionDelayTicks: number;
}

function spawnNextWave(
  activity: CombatActivity,
  stage: StageDef,
  ctx: ActivityContext,
  params: SpawnParams,
): void {
  const hero = findHero(activity, ctx.state);
  if (!hero) {
    enterStopped(activity, ctx);
    return;
  }

  activity.waveIndex += 1;
  const waveSize = Math.max(1, stage.waveSize ?? 1);
  const enemyIds: string[] = [];
  for (let i = 0; i < waveSize; i++) {
    const monsterId = ctx.rng.pick(stage.monsters);
    const def = getMonster(monsterId);
    const instanceId = `enemy.${monsterId}.w${activity.waveIndex}.${i}`;
    const enemy = createEnemy({
      instanceId,
      def,
      attrDefs: ctx.attrDefs,
    });
    ctx.state.actors.push(enemy);
    enemyIds.push(instanceId);
  }

  const battle = createBattle({
    id: `battle.${activity.id}.w${activity.waveIndex}`,
    mode: stage.mode,
    participantIds: [hero.id, ...enemyIds],
    actionDelayTicks: params.actionDelayTicks,
    startedAtTick: ctx.currentTick,
    onDeath: (victim, bctx) => onParticipantDeath(victim, bctx, hero),
  });

  activity.currentBattle = battle;
  activity.phase = "fighting";
  activity.lastTransitionTick = ctx.currentTick;
}

function removeDefeatedEnemies(battle: Battle, state: GameState): void {
  const keepById = new Set<string>();
  for (const id of battle.participantIds) keepById.add(id);
  state.actors = state.actors.filter((a) => {
    if (!keepById.has(a.id)) return true;
    if (!isEnemy(a)) return true;
    return a.currentHp > 0;
  });
}

// ---------- Death rewards ----------

/** When an enemy dies, grant the hero its xpReward by synthesizing an
 *  instant Effect and running it through the normal Effect pipeline. This
 *  keeps XP / loot / items flowing through ONE codepath (applyEffect), so
 *  future features — crit rewards, loot drops, conditional bonuses — plug
 *  in without another grant-foo helper. */
function onParticipantDeath(
  victim: Character,
  bctx: TickBattleContext,
  hero: PlayerCharacter,
): void {
  if (!isEnemy(victim)) return; // only enemy deaths reward the hero

  const enemy = victim as Enemy;
  // Content is the source of truth; missing defs should throw loudly.
  const def = getMonster(enemy.defId);
  const xpReward = def.xpReward;
  if (xpReward <= 0) return;

  // Synthesize an instant reward effect. Not registered in content — lives
  // and dies with this kill.
  const rewardEffect = {
    id: `effect.runtime.kill_reward.${enemy.defId}` as never,
    kind: "instant" as const,
    rewards: { charXp: xpReward },
  };

  const ectx: EffectContext = {
    state: bctx.state,
    bus: bctx.bus,
    rng: bctx.rng,
    attrDefs: bctx.attrDefs,
    currentTick: bctx.currentTick,
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

function enterStopped(activity: CombatActivity, ctx: ActivityContext): void {
  activity.phase = "stopped";
  activity.currentBattle = null;
  const hero = findHero(activity, ctx.state);
  if (hero) hero.activity = null;
  ctx.bus.emit("activityComplete", {
    charId: activity.ownerCharacterId,
    kind: ACTIVITY_COMBAT_KIND,
  });
}
