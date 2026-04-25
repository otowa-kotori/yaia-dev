// CombatActivity — party combat in a combat zone (infinite loop).
//
// This is strictly the ACTIVITY layer: it drives battle ticks, handles
// hero recovery, explicitly requests enemy searches, and issues stop cleanup.
// The ACTOR POPULATION of the instance (spawning/searching waves of enemies)
// is the StageController's job — CombatActivity just looks at the world and
// fights whatever enemies are currently in the running instance.
//
// Party model (unified with DungeonActivity):
//   CombatActivity is a WorldActivity keyed by a shared stageId. It holds
//   `partyCharIds` — one or more heroes that share the Stage + Battle.
//   Solo mode is just partyCharIds = [heroId]. Kill rewards are distributed
//   to all living party members.
//
// State machine:
//
//   searchingEnemies — actively looking for the next combat zone wave.
//     | enemies appear -> fighting
//     | stopRequested   -> stopped
//   fighting          — a Battle is active; delegate ticks to tickBattle.
//     | battle ends players_won -> searchingEnemies / recovering
//     | battle ends enemies_won -> recovering
//     | stopRequested (and battle ends) -> stopped
//   recovering        — party HP too low after battle. Regen HP per tick until full.
//     | party full-hp -> searchingEnemies
//     | stopRequested (at full-hp) -> stopped
//   stopped           — terminal.
//
// Kill rewards flow via the bus — CombatActivity subscribes to 'kill' for
// enemies in its current battle. Per-kill rewards (XP, currency) go to all
// living party members. Wave rewards likewise.
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
import type { EffectDef, ItemId } from "../../content/types";

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
import type { WorldActivity, ActivityContext } from "./types";

export const ACTIVITY_COMBAT_KIND = "activity.combat";

export interface CombatActivityOptions {
  /** Shared stage id that all party members reference. */
  stageId: string;
  /** Character ids participating. Solo = [heroId]. */
  partyCharIds: string[];
  ctxProvider: () => ActivityContext;
  /** HP regen per tick during `recovering`, in [0, 1]. Default 0.02. */
  recoverHpPctPerTick?: number;
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

export interface CombatActivity extends WorldActivity {
  readonly kind: typeof ACTIVITY_COMBAT_KIND;
  readonly stageId: string;
  readonly partyCharIds: string[];
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

  const initialCtx = opts.ctxProvider();
  const resume = opts.resume;

  const activity: CombatActivity = {
    id: `combat:${opts.stageId}`,
    kind: ACTIVITY_COMBAT_KIND,
    startedAtTick: initialCtx.currentTick,
    stageId: opts.stageId,
    partyCharIds: opts.partyCharIds.slice(),
    phase: resume?.phase ?? "searchingEnemies",
    currentBattleId: resume?.currentBattleId ?? null,
    lastTransitionTick: resume?.lastTransitionTick ?? initialCtx.currentTick,
    stopRequested: false,

    onStart(ctx) {
      // Fresh-start reset only. The resume path (opts.resume set) never hits
      // onStart because the caller skips it when rehydrating from a save.
      for (const hero of getPartyHeroes(activity, ctx.state)) {
        hero.currentHp = getAttr(hero, ATTR.MAX_HP, ctx.attrDefs);
        hero.currentMp = getAttr(hero, ATTR.MAX_MP, ctx.attrDefs);
        hero.activeEffects = [];
        hero.cooldowns = {};
      }
      syncCombatToHeroes(activity, ctx.state);
    },

    tick() {
      const ctx = opts.ctxProvider();
      stepPhase(activity, ctx, {
        recoverHpPctPerTick: recoverHp,
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
  _params: StepParams,
): void {
  if (activity.stopRequested) {
    enterStopped(activity, ctx);
    return;
  }
  const session = ctx.state.stages[activity.stageId];
  if (!session) return;

  if (!session.currentWave && !session.pendingCombatWaveSearch && session.mode.kind === "combatZone") {
    const zone = getCombatZone(session.mode.combatZoneId);
    beginCombatWaveSearch(zone, session, ctx.currentTick);
  }

  const enemies = stageEnemies(session, ctx.state).filter((e) => e.currentHp > 0);
  if (enemies.length === 0) return;

  openBattle(activity, enemies, ctx);
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
    syncCombatToHeroes(activity, ctx.state);
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

  const session = ctx.state.stages[activity.stageId];
  const resolvedOutcome =
    battle.outcome === "players_won" ? "players_won" : "enemies_won";
  if (session?.currentWave?.status === "active") {
    session.currentWave.status =
      resolvedOutcome === "players_won" ? "victory" : "defeat";
    if (resolvedOutcome === "players_won") {
      grantWaveRewards(activity, session, ctx);
    }
    ctx.bus.emit("waveResolved", {
      charId: activity.partyCharIds[0] ?? "",
      locationId: session.locationId,
      stageId: activity.stageId,
      battleId: battle.id,
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

  const heroes = getPartyHeroes(activity, ctx.state);
  if (heroes.length === 0) {
    activity.phase = "stopped";
    return;
  }

  activity.phase = partyNeedsRecovery(activity, heroes, ctx)
    ? "recovering"
    : "searchingEnemies";
  syncCombatToHeroes(activity, ctx.state);
}

function stepRecovering(
  activity: CombatActivity,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const heroes = getPartyHeroes(activity, ctx.state);
  if (heroes.length === 0) {
    enterStopped(activity, ctx);
    return;
  }

  let allFull = true;
  for (const hero of heroes) {
    const maxHp = getAttr(hero, ATTR.MAX_HP, ctx.attrDefs);
    if (maxHp <= 0) continue;
    const per = Math.max(1, Math.floor(maxHp * params.recoverHpPctPerTick));
    hero.currentHp = Math.min(maxHp, hero.currentHp + per);
    if (hero.currentHp < maxHp) allFull = false;
  }

  if (allFull) {
    if (activity.stopRequested) {
      enterStopped(activity, ctx);
      return;
    }
    activity.phase = "searchingEnemies";
    activity.lastTransitionTick = ctx.currentTick;
    syncCombatToHeroes(activity, ctx.state);
  }
}

// ---------- Battle setup ----------

function openBattle(
  activity: CombatActivity,
  enemies: Enemy[],
  ctx: ActivityContext,
): void {
  const heroes = getPartyHeroes(activity, ctx.state);
  if (heroes.length === 0) return;

  const session = ctx.state.stages[activity.stageId];
  if (!session?.currentWave) {
    throw new Error(`combat.openBattle: stage "${activity.stageId}" has enemies but no active wave`);
  }

  const intents: Record<string, string> = {};
  for (const h of heroes) intents[h.id] = INTENT.RANDOM_ATTACK;
  for (const e of enemies) intents[e.id] = INTENT.RANDOM_ATTACK;

  const battleId = mintBattleId(ctx.state);
  const battle = createBattle({
    id: battleId,
    mode: heroes.length > 1 ? "party" : "solo",
    participantIds: [...heroes.map((h) => h.id), ...enemies.map((e) => e.id)],
    startedAtTick: ctx.currentTick,
    intents,
    metadata: {
      stageId: activity.stageId,
      locationId: session.locationId,
      combatZoneId: session.currentWave.combatZoneId,
      waveId: session.currentWave.waveId,
      waveIndex: session.currentWave.waveIndex,
      partyCharIds: activity.partyCharIds.slice(),
    },
  });
  ctx.state.battles.push(battle);
  activity.currentBattleId = battle.id;
  activity.phase = "fighting";
  activity.lastTransitionTick = ctx.currentTick;
  syncCombatToHeroes(activity, ctx.state);
  ctx.bus.emit("battleStarted", {
    battleId: battle.id,
    stageId: activity.stageId,
    locationId: session.locationId,
    participantIds: battle.participantIds.slice(),
    partyCharIds: activity.partyCharIds.slice(),
    combatZoneId: session.currentWave.combatZoneId,
    waveId: session.currentWave.waveId,
    waveIndex: session.currentWave.waveIndex,
  });
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

  const enemy = victim as Enemy;
  const def = getMonster(enemy.defId);
  const xpReward = def.xpReward;

  const hasXp = xpReward > 0;
  const hasCurrency =
    def.currencyReward && Object.keys(def.currencyReward).length > 0;
  if (!hasXp && !hasCurrency) return;

  const ectx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
    currencyChangeSource: "kill_reward",
  };

  // Grant kill rewards split across living party members.

  // XP and currency are divided by headcount; each hero gets their share.
  const heroes = getPartyHeroes(activity, ctx.state);
  const living = heroes.filter((h) => h.currentHp > 0);
  if (living.length === 0) return;
  const share = living.length;

  const splitXp = hasXp ? Math.max(1, Math.floor(xpReward / share)) : undefined;
  const splitCurrencies = hasCurrency
    ? Object.fromEntries(
        Object.entries(def.currencyReward!).map(([k, v]) => [k, Math.max(1, Math.floor(v / share))]),
      )
    : undefined;

  const splitEffect = {
    id: `effect.runtime.kill_reward.${enemy.defId}` as never,
    kind: "instant" as const,
    rewards: {
      charXp: splitXp,
      currencies: splitCurrencies,
    },
  };

  for (const hero of living) {
    applyEffect(splitEffect, victim, hero, ectx);
  }
}

function grantWaveRewards(
  activity: CombatActivity,
  session: StageSession,
  ctx: ActivityContext,
): void {
  const activeWave = session.currentWave;
  if (!activeWave || activeWave.rewardGranted) return;

  const zone = getCombatZone(activeWave.combatZoneId);
  const wave = lookupWave(zone, activeWave.waveId);
  activeWave.rewardGranted = true;
  if (!wave.rewards) return;

  const heroes = getPartyHeroes(activity, ctx.state);
  const living = heroes.filter((h) => h.currentHp > 0);
  if (living.length === 0) return;

  const ectx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
    currencyChangeSource: "wave_reward",
  };

  // Items: roll once, give to a random living hero.

  const items: { itemId: ItemId; qty: number }[] = [];
  for (const drop of wave.rewards.drops ?? []) {
    if (!ctx.rng.chance(drop.chance)) continue;
    const qty = ctx.rng.int(drop.minQty, drop.maxQty);
    if (qty > 0) items.push({ itemId: drop.itemId, qty });
  }
  if (items.length > 0) {
    const lucky = ctx.rng.pick(living);
    const itemEffect: EffectDef = {
      id: `effect.runtime.wave_reward.items.${session.locationId}.${activeWave.waveIndex}` as never,
      kind: "instant",
      rewards: { items },
    };
    applyEffect(itemEffect, lucky, lucky, ectx);
  }

  // Currencies: split evenly across living heroes.
  const rewards = wave.rewards;
  const hasCurrencies = !!rewards.currencies && Object.keys(rewards.currencies).length > 0;
  if (hasCurrencies) {
    const share = living.length;
    const splitCurrencies = Object.fromEntries(
      Object.entries(rewards.currencies!).map(([k, v]) => [k, Math.max(1, Math.floor(v / share))]),
    );
    const currencyEffect: EffectDef = {
      id: `effect.runtime.wave_reward.currency.${session.locationId}.${activeWave.waveIndex}` as never,
      kind: "instant",
      rewards: { currencies: splitCurrencies },
    };
    for (const hero of living) {
      applyEffect(currencyEffect, hero, hero, ectx);
    }
  }
}

// ---------- Helpers ----------

function getPartyHeroes(
  activity: CombatActivity,
  state: GameState,
): PlayerCharacter[] {
  const result: PlayerCharacter[] = [];
  for (const charId of activity.partyCharIds) {
    const a = state.actors.find((x) => x.id === charId);
    if (a && isPlayer(a)) result.push(a);
  }
  return result;
}

function lookupBattle(
  activity: CombatActivity,
  state: GameState,
): Battle | null {
  if (!activity.currentBattleId) return null;
  return state.battles.find((b) => b.id === activity.currentBattleId) ?? null;
}

function partyNeedsRecovery(
  activity: CombatActivity,
  heroes: PlayerCharacter[],
  ctx: ActivityContext,
): boolean {
  const session = ctx.state.stages[activity.stageId];
  if (!session || session.mode.kind !== "combatZone") return false;
  const zone = getCombatZone(session.mode.combatZoneId);
  const threshold = zone.recoverBelowHpFactor ?? 0;
  if (threshold <= 0) return false;

  for (const hero of heroes) {
    if (hero.currentHp <= 0) return true;
    const maxHp = getAttr(hero, ATTR.MAX_HP, ctx.attrDefs);
    if (maxHp > 0 && hero.currentHp / maxHp <= threshold) return true;
  }
  return false;
}

function enterStopped(activity: CombatActivity, ctx: ActivityContext): void {
  activity.phase = "stopped";
  activity.currentBattleId = null;
  // Clear activity reference on all party heroes.
  for (const hero of getPartyHeroes(activity, ctx.state)) {
    hero.activity = null;
  }
  const dispose = (activity as unknown as { __disposeKill?: () => void })
    .__disposeKill;
  if (dispose) dispose();
  // Emit for the first party member (Session layer uses charId to route).
  ctx.bus.emit("activityComplete", {
    charId: activity.partyCharIds[0] ?? "",
    kind: ACTIVITY_COMBAT_KIND,
  });
}

/** Mirror current activity state onto all party heroes so autosave captures
 *  the latest phase / battle / transition tick. */
function syncCombatToHeroes(
  activity: CombatActivity,
  state: GameState,
): void {
  const heroes = getPartyHeroes(activity, state);
  for (const hero of heroes) {
    if (activity.phase === "stopped") {
      hero.activity = null;
      continue;
    }
    hero.activity = {
      kind: ACTIVITY_COMBAT_KIND,
      startedAtTick: activity.startedAtTick,
      data: {
        stageId: activity.stageId,
        partyCharIds: activity.partyCharIds,
        phase: activity.phase,
        currentBattleId: activity.currentBattleId,
        lastTransitionTick: activity.lastTransitionTick,
      },
    };
  }
}
