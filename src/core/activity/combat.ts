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
//   A fresh Battle instance is created per wave and pushed into
//   GameState.battles. The previous Battle's deathsReported and log are
//   discarded (we don't need them across waves). The owner character is
//   reused across waves; its currentHp / cooldowns / activeEffects carry
//   over. Enemies spawn on demand via createEnemy and are pushed into
//   GameState.actors. When a wave is cleared, defeated enemies are removed
//   from state.actors.
//
// Kill rewards:
//   The activity subscribes to the 'kill' event on the bus at construction
//   time. Each kill triggers an instant reward Effect on the hero — this
//   flows through applyEffect, so loot, XP, crit bonuses, etc. share one
//   codepath. The subscription is torn down when the activity transitions
//   to 'stopped'.
//
// Save/load:
//   The activity is a runtime-only Tickable; it is NOT persisted directly.
//   What persists is the PlayerCharacter.activity field (kind + data)
//   holding the stageId + phase + lastTransitionTick. On load, store code
//   calls createCombatActivity again with the saved stageId, and the
//   battle (which IS persisted via GameState.battles) resumes naturally
//   because the activity looks it up by id.

import {
  createEnemy,
  getAttr,
  isEnemy,
  isPlayer,
  type Character,
  type Enemy,
  type PlayerCharacter,
} from "../actor";
import { ATTR } from "../attribute";
import type { StageDef } from "../content/types";
import { getMonster, getStage } from "../content/registry";
import type { GameState } from "../state/types";
import {
  createBattle,
  tickBattle,
  type Battle,
  type TickBattleContext,
} from "../combat";
import { INTENT } from "../intent";
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
  /** Pre-set initial phase / wave index / battle id. Used on load-from-save
   *  to resume an in-progress activity. Defaults spawn a fresh wave. */
  resume?: {
    phase: CombatActivityPhase;
    waveIndex: number;
    lastTransitionTick: number;
    currentBattleId: string | null;
  };
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
  /** Id of the current Battle in GameState.battles, if any. */
  currentBattleId: string | null;
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

  const initialCtx = opts.ctxProvider();
  const resume = opts.resume;

  const activity: CombatActivity = {
    id,
    kind: ACTIVITY_COMBAT_KIND,
    startedAtTick: initialCtx.currentTick,
    ownerCharacterId: opts.ownerCharacterId,
    stageId: opts.stageId,
    phase: resume?.phase ?? "fighting",
    currentBattleId: resume?.currentBattleId ?? null,
    waveIndex: resume?.waveIndex ?? 0,
    lastTransitionTick: resume?.lastTransitionTick ?? initialCtx.currentTick,
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

  // Subscribe to 'kill' events for the lifetime of the activity so we can
  // grant rewards to the hero. Torn down in enterStopped().
  const disposeKill = initialCtx.bus.on("kill", (payload) => {
    if (activity.phase === "stopped") return;
    onParticipantKilled(activity, payload.victimId, opts.ctxProvider());
  });
  // Stash the disposer on the activity so enterStopped can invoke it.
  (activity as unknown as { __disposeKill: () => void }).__disposeKill =
    disposeKill;

  // If we're not resuming, spawn the first wave immediately so subscribers
  // see a populated battle.
  if (!resume) {
    spawnNextWave(activity, stage, initialCtx, {
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
  _stage: StageDef,
  ctx: ActivityContext,
  _params: StepParams,
): void {
  const battle = lookupBattle(activity, ctx.state);
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

  // Wave resolved. Clean up defeated enemies + the concluded battle record.
  removeDefeatedEnemies(battle, ctx.state);
  removeBattle(ctx.state, battle.id);

  const hero = findHero(activity, ctx.state);
  activity.currentBattleId = null;
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

  const maxHp = getAttr(hero, ATTR.MAX_HP, ctx.attrDefs);
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

  // All participants get RANDOM_ATTACK by default. Explicit per-actor intents
  // (boss scripts, tactical AIs) slot in via the intents map.
  const intents: Record<string, string> = {};
  intents[hero.id] = INTENT.RANDOM_ATTACK;
  for (const eid of enemyIds) intents[eid] = INTENT.RANDOM_ATTACK;

  const battle = createBattle({
    id: `battle.${activity.id}.w${activity.waveIndex}`,
    mode: stage.mode,
    participantIds: [hero.id, ...enemyIds],
    actionDelayTicks: params.actionDelayTicks,
    startedAtTick: ctx.currentTick,
    intents,
  });

  ctx.state.battles.push(battle);
  activity.currentBattleId = battle.id;
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

function removeBattle(state: GameState, battleId: string): void {
  state.battles = state.battles.filter((b) => b.id !== battleId);
}

// ---------- Kill rewards ----------

/** When an enemy participating in this activity's current battle dies, grant
 *  the hero its xpReward by synthesizing an instant Effect and running it
 *  through the normal Effect pipeline. This keeps XP / loot / items flowing
 *  through ONE codepath (applyEffect), so future features — crit rewards,
 *  loot drops, conditional bonuses — plug in without another grant-foo
 *  helper. */
function onParticipantKilled(
  activity: CombatActivity,
  victimId: string,
  ctx: ActivityContext,
): void {
  // Only grant for kills in THIS activity's current battle; other bus
  // listeners might run for other activities.
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
  if (xpReward <= 0) return;

  // Synthesize an instant reward effect. Not registered in content — lives
  // and dies with this kill.
  const rewardEffect = {
    id: `effect.runtime.kill_reward.${enemy.defId}` as never,
    kind: "instant" as const,
    rewards: { charXp: xpReward },
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

function lookupBattle(activity: CombatActivity, state: GameState): Battle | null {
  if (!activity.currentBattleId) return null;
  return state.battles.find((b) => b.id === activity.currentBattleId) ?? null;
}

function enterStopped(activity: CombatActivity, ctx: ActivityContext): void {
  activity.phase = "stopped";
  activity.currentBattleId = null;
  const hero = findHero(activity, ctx.state);
  if (hero) hero.activity = null;
  // Tear down the 'kill' subscription to avoid leaking listeners across
  // repeated start/stop cycles.
  const dispose = (activity as unknown as { __disposeKill?: () => void })
    .__disposeKill;
  if (dispose) dispose();
  ctx.bus.emit("activityComplete", {
    charId: activity.ownerCharacterId,
    kind: ACTIVITY_COMBAT_KIND,
  });
}
