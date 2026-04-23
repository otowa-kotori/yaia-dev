// CombatActivity — player "I am actively fighting in the current instance".
//
// This is strictly the ACTIVITY layer: it drives battle ticks, handles
// hero recovery, explicitly requests enemy searches, and issues stop cleanup.
// The ACTOR POPULATION of the instance (spawning/searching waves of enemies)
// is the StageController's job — CombatActivity just looks at the world and
// fights whatever enemies are currently in the running instance.
//
// State machine:
//
//   searchingEnemies — the hero is actively looking for the next combat zone wave.
//                      StageController only starts / progresses a wave search
//                      when this phase requests it.
//     | enemies appear -> fighting
//     | stopRequested   -> stopped
//   fighting          — a Battle is active; delegate ticks to tickBattle.
//     | battle ends players_won -> searchingEnemies / recovering
//     | battle ends enemies_won -> recovering
//     | stopRequested (and battle ends) -> stopped
//   recovering        — hero HP too low after battle. Regen HP per tick until full.
//     | hero full-hp -> searchingEnemies
//     | stopRequested (at full-hp) -> stopped
//   stopped           — terminal.
//
// Kill rewards flow via the bus — CombatActivity subscribes to 'kill' for
// enemies in its current battle and hands the hero an instant reward
// Effect per kill. Wave rewards are granted only when the wave resolves with
// players_won. See onParticipantKilled / grantWaveRewards below.
//
// Save/load: persisted in PlayerCharacter.activity.data = { phase,
// currentBattleId, lastTransitionTick }. The stage instance the player is in
// is persisted in GameState.stages[hero.stageId]; the activity does not
// own instance state.
//
// hero.activity self-sync: every phase transition calls syncCombatToHero so
// the persisted snapshot is always fresh. Session layer must NOT manually
// mirror state — the activity is the single writer (mirrors gather.ts).
//
// Lifecycle owners:
//   - Pre-fight reset (refill HP/MP, wipe activeEffects/cooldowns) happens in
//     onStart so it runs on fresh starts but NOT on resume-from-save.

import {
  getAttr,
  isEnemy,
  isPlayer,
  type Character,
  type Enemy,
  type PlayerCharacter,
} from "../../entity/actor";
import { ATTR } from "../../entity/attribute";
import { getMonster, getCombatZone } from "../../content/registry";
import type { EffectDef, ItemId, WaveRewardDef } from "../../content/types";

import type { GameState } from "../../infra/state/types";
import {
  createBattle,
  tickBattle,
  type Battle,
  type TickBattleContext,
} from "../../combat/battle";
import { INTENT } from "../../combat/intent";
import { applyEffect, type EffectContext } from "../../behavior/effect";
import {
  beginCombatWaveSearch,
  lookupWave,
  stageEnemies,
} from "../stage";
import { mintBattleId } from "../../runtime-ids";
import type { StageSession } from "../stage/types";
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
  | "searchingEnemies"
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
  // 0.02 = ~50 ticks (5s @ 10Hz) to full-heal from zero, a floor tuning
  // choice. Session does not pass this any more; if it ever needs to be
  // per-stage, expose it via content.
  const recoverHp = opts.recoverHpPctPerTick ?? 0.02;
  const actionDelay = opts.actionDelayTicks ?? 8;

  const initialCtx = opts.ctxProvider();
  const resume = opts.resume;

  const activity: CombatActivity = {
    id: `combat:${opts.ownerCharacterId}`,
    kind: ACTIVITY_COMBAT_KIND,
    startedAtTick: initialCtx.currentTick,
    ownerCharacterId: opts.ownerCharacterId,
    phase: resume?.phase ?? "searchingEnemies",
    currentBattleId: resume?.currentBattleId ?? null,
    lastTransitionTick: resume?.lastTransitionTick ?? initialCtx.currentTick,
    stopRequested: false,

    onStart(ctx) {
      // Fresh-start reset only. The resume path (opts.resume set) never hits
      // onStart because the caller skips it when rehydrating from a save.
      const hero = findHero(activity, ctx.state);
      if (!hero) return;
      hero.currentHp = getAttr(hero, ATTR.MAX_HP, ctx.attrDefs);
      hero.currentMp = getAttr(hero, ATTR.MAX_MP, ctx.attrDefs);
      hero.activeEffects = [];
      hero.cooldowns = {};
      syncCombatToHero(activity, hero);
    },

    tick() {
      const ctx = opts.ctxProvider();
      stepPhase(activity, ctx, {
        recoverHpPctPerTick: recoverHp,
        actionDelayTicks: actionDelay,
      });
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
    case "searchingEnemies":
      stepSearching(activity, ctx, params);
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

/** While searching, request the next wave search if needed and poll the current
 *  stage for alive enemies. When any appear, open a battle against them. */
function stepSearching(
  activity: CombatActivity,
  ctx: ActivityContext,
  params: StepParams,
): void {
  if (activity.stopRequested) {
    enterStopped(activity, ctx);
    return;
  }
  const hero = findHero(activity, ctx.state);
  if (!hero) return;
  const session = hero.stageId ? ctx.state.stages[hero.stageId] : undefined;
  if (!session) return;

  if (!session.currentWave && !session.pendingCombatWaveSearch && session.mode.kind === "combatZone") {
    const zone = getCombatZone(session.mode.combatZoneId);
    beginCombatWaveSearch(zone, session, ctx.currentTick);
  }

  const enemies = stageEnemies(session, ctx.state).filter((e) => e.currentHp > 0);
  if (enemies.length === 0) return;

  openBattle(activity, hero, enemies, ctx, params);
}

function stepFighting(
  activity: CombatActivity,
  ctx: ActivityContext,
  _params: StepParams,
): void {
  const battle = lookupBattle(activity, ctx.state);
  if (!battle) {
    // Lost the battle reference somehow — fall back to searching.
    activity.phase = "searchingEnemies";
    activity.currentBattleId = null;
    const hero = findHero(activity, ctx.state);
    if (hero) syncCombatToHero(activity, hero);
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
  // reclaims / clears wave enemies on its own schedule.
  removeBattle(ctx.state, battle.id);

  const hero = findHero(activity, ctx.state);
  const session = hero?.stageId ? ctx.state.stages[hero.stageId] : undefined;
  const resolvedOutcome =
    battle.outcome === "players_won" ? "players_won" : "enemies_won";
  if (session?.currentWave?.status === "active") {
    session.currentWave.status =
      resolvedOutcome === "players_won" ? "victory" : "defeat";
    if (resolvedOutcome === "players_won" && hero) {
      grantWaveRewards(session, hero, ctx);
    }
    ctx.bus.emit("waveResolved", {
      charId: activity.ownerCharacterId,
      locationId: session.locationId,
      combatZoneId: session.currentWave.combatZoneId,
      waveId: session.currentWave.waveId,
      waveIndex: session.currentWave.waveIndex,
      outcome: resolvedOutcome,
    });
  }

  activity.currentBattleId = null;
  activity.lastTransitionTick = ctx.currentTick;

  if (activity.stopRequested) {
    enterStopped(activity, ctx);
    return;
  }

  if (!hero) {
    activity.phase = "stopped";
    return;
  }

  activity.phase = shouldRecoverAfterBattle(hero, ctx)
    ? "recovering"
    : "searchingEnemies";
  syncCombatToHero(activity, hero);
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
    activity.phase = "searchingEnemies";
    activity.lastTransitionTick = ctx.currentTick;
    syncCombatToHero(activity, hero);
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
  const intents: Record<string, string> = {};
  intents[hero.id] = INTENT.RANDOM_ATTACK;
  for (const e of enemies) intents[e.id] = INTENT.RANDOM_ATTACK;

  const battleId = mintBattleId(ctx.state);
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
  syncCombatToHero(activity, hero);
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

function grantWaveRewards(
  session: StageSession,
  hero: PlayerCharacter,
  ctx: ActivityContext,
): void {
  const activeWave = session.currentWave;
  if (!activeWave || activeWave.rewardGranted) return;

  const zone = getCombatZone(activeWave.combatZoneId);
  const wave = lookupWave(zone, activeWave.waveId);
  const rewardEffect = buildWaveRewardEffect(
    session.locationId,
    activeWave.waveIndex,
    wave.rewards,
    ctx,
  );
  activeWave.rewardGranted = true;
  if (!rewardEffect) return;

  const ectx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
  };
  applyEffect(rewardEffect, hero, hero, ectx);
}

function buildWaveRewardEffect(
  locationId: string,
  waveIndex: number,
  rewards: WaveRewardDef | undefined,
  ctx: ActivityContext,
): EffectDef | null {
  if (!rewards) return null;

  const items: { itemId: ItemId; qty: number }[] = [];

  for (const drop of rewards.drops ?? []) {
    if (!ctx.rng.chance(drop.chance)) continue;
    const qty = ctx.rng.int(drop.minQty, drop.maxQty);
    if (qty <= 0) continue;
    items.push({ itemId: drop.itemId, qty });
  }

  const hasItems = items.length > 0;
  const hasCurrencies =
    !!rewards.currencies && Object.keys(rewards.currencies).length > 0;
  if (!hasItems && !hasCurrencies) return null;

  return {
    id: `effect.runtime.wave_reward.${locationId}.${waveIndex}` as never,
    kind: "instant",
    rewards: {
      items: hasItems ? items : undefined,
      currencies: hasCurrencies ? rewards.currencies : undefined,
    },
  };
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

function shouldRecoverAfterBattle(
  hero: PlayerCharacter,
  ctx: ActivityContext,
): boolean {
  if (hero.currentHp <= 0) return true;
  const session = hero.stageId ? ctx.state.stages[hero.stageId] : undefined;
  if (!session || session.mode.kind !== "combatZone") return false;
  const zone = getCombatZone(session.mode.combatZoneId);
  const threshold = zone.recoverBelowHpFactor ?? 0;
  if (threshold <= 0) return false;

  const maxHp = getAttr(hero, ATTR.MAX_HP, ctx.attrDefs);
  if (maxHp <= 0) return true;
  return hero.currentHp / maxHp <= threshold;
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

/** Mirror current activity state onto hero.activity so autosave captures
 *  the latest phase / battle / transition tick. Called at every phase
 *  transition; the activity is the single writer (mirrors gather.ts). */
function syncCombatToHero(
  activity: CombatActivity,
  hero: PlayerCharacter,
): void {
  if (activity.phase === "stopped") {
    hero.activity = null;
    return;
  }
  hero.activity = {
    kind: ACTIVITY_COMBAT_KIND,
    startedAtTick: activity.startedAtTick,
    data: {
      phase: activity.phase,
      currentBattleId: activity.currentBattleId,
      lastTransitionTick: activity.lastTransitionTick,
    },
  };
}
