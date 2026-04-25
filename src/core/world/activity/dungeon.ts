// DungeonWorldActivity — drives a multi-character dungeon run.
//
// Unlike CombatActivity (per-character, infinite random loop), Dungeon is a
// WorldActivity that orchestrates a *party* through a *fixed-order* sequence
// of waves. All participating characters share one Stage + Battle.
//
// State machine (per dungeon run):
//
//   spawningWave  — transition between waves; spawn the next wave's enemies.
//     | enemies spawned → fighting
//   fighting      — a shared Battle is active; delegate ticks to tickBattle.
//     | battle won (players_won) → waveCleared
//     | battle lost (enemies_won) → failed
//   waveCleared   — award wave rewards, check if more waves remain.
//     | more waves → recovering / spawningWave
//     | last wave  → completed
//   recovering    — heal party between waves if HP is low.
//     | party healed → spawningWave
//   completed     — terminal success. Emit event, restore characters.
//   failed        — terminal failure (party wipe). Restore characters.
//   abandoned     — terminal early exit. Restore characters.
//
// Lifecycle owners:
//   - Session layer creates the DungeonSession, saves character states, assigns
//     hero.dungeonSessionId, builds the shared stage, and registers this activity.
//   - This activity drives tick-by-tick progression.
//   - Session layer calls abandon() from the outside when the player requests exit.
//   - On terminal states, this activity emits the appropriate event and calls
//     the provided restoreCallback so Session can restore characters.

import {
  getAttr,
  isEnemy,
  isPlayer,
  type Enemy,
  type PlayerCharacter,
} from "../../entity/actor";
import { ATTR } from "../../entity/attribute";
import { getDungeon, getMonster } from "../../content/registry";
import type { DungeonDef, DungeonWaveDef, WaveRewardDef, EffectDef, ItemId } from "../../content/types";
import {
  createBattle,
  tickBattle,
  type Battle,
  type TickBattleContext,
} from "../../combat/battle";
import { createEnemy } from "../../entity/actor";
import { buildBattleIntents } from "../../combat/intent";
import { applyEffect, type EffectContext } from "../../behavior/effect";
import { mintBattleId, mintMonsterInstanceId } from "../../runtime-ids";
import { stageEnemies } from "../stage";
import type { StageSession } from "../stage/types";
import type { WorldActivity, ActivityContext } from "./types";
import type { GameState } from "../../infra/state/types";
import type { DungeonSession } from "../../infra/state/types";

export const ACTIVITY_DUNGEON_KIND = "activity.dungeon";

export type DungeonPhase =
  | "spawningWave"
  | "fighting"
  | "waveCleared"
  | "recovering"
  | "completed"
  | "failed"
  | "abandoned";

export interface DungeonActivityOptions {
  dungeonSessionId: string;
  ctxProvider: () => ActivityContext;
  /** HP regen per tick during recovery, in [0, 1]. Default 0.02. */
  recoverHpPctPerTick?: number;
  /** Restore callback invoked on terminal states. Session layer provides this
   *  to restore characters to their pre-dungeon state. */
  restoreParty: (ctx: ActivityContext) => void;
  /** Pre-set initial state for load-from-save. */
  resume?: {
    phase: DungeonPhase;
    currentBattleId: string | null;
    transitionTick: number;
  };
}

export interface DungeonActivity extends WorldActivity {
  readonly kind: typeof ACTIVITY_DUNGEON_KIND;
  readonly dungeonSessionId: string;
  phase: DungeonPhase;
  currentBattleId: string | null;
  /** Tick at which the last phase transition happened. */
  transitionTick: number;
}

// ---------- Factory ----------

export function createDungeonActivity(
  opts: DungeonActivityOptions,
): DungeonActivity {
  const recoverHp = opts.recoverHpPctPerTick ?? 0.02;
  const initialCtx = opts.ctxProvider();

  const resume = opts.resume;

  const activity: DungeonActivity = {
    id: `dungeon:${opts.dungeonSessionId}`,
    kind: ACTIVITY_DUNGEON_KIND,
    startedAtTick: initialCtx.currentTick,
    dungeonSessionId: opts.dungeonSessionId,
    phase: resume?.phase ?? "spawningWave",
    currentBattleId: resume?.currentBattleId ?? null,
    transitionTick: resume?.transitionTick ?? initialCtx.currentTick,

    tick() {
      const ctx = opts.ctxProvider();
      const ds = ctx.state.dungeons[opts.dungeonSessionId];
      if (!ds || isTerminal(activity.phase)) return;
      stepDungeon(activity, ds, ctx, {
        recoverHpPctPerTick: recoverHp,
        restoreParty: opts.restoreParty,
      });
    },

    isDone() {
      return isTerminal(activity.phase);
    },
  };

  // Subscribe to kill events for per-kill rewards (XP, currency).
  const disposeKill = initialCtx.bus.on("kill", (payload) => {
    if (isTerminal(activity.phase)) return;
    onParticipantKilled(activity, payload.victimId, opts.ctxProvider());
  });
  (activity as unknown as { __disposeKill: () => void }).__disposeKill =
    disposeKill;

  return activity;
}

function isTerminal(phase: DungeonPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "abandoned";
}

// ---------- State machine ----------

interface StepParams {
  recoverHpPctPerTick: number;
  restoreParty: (ctx: ActivityContext) => void;
}

function stepDungeon(
  activity: DungeonActivity,
  ds: DungeonSession,
  ctx: ActivityContext,
  params: StepParams,
): void {
  switch (activity.phase) {
    case "spawningWave":
      stepSpawningWave(activity, ds, ctx, params);
      return;
    case "fighting":
      stepFighting(activity, ds, ctx, params);
      return;
    case "waveCleared":
      stepWaveCleared(activity, ds, ctx, params);
      return;
    case "recovering":
      stepRecovering(activity, ds, ctx, params);
      return;
  }
}

// --- spawningWave ---

function stepSpawningWave(
  activity: DungeonActivity,
  ds: DungeonSession,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const def = getDungeon(ds.dungeonId);
  const session = ctx.state.stages[ds.stageId];
  if (!session) {
    enterFailed(activity, ds, ctx, params);
    return;
  }

  // Wait for transition ticks.
  const elapsed = ctx.currentTick - activity.transitionTick;
  if (elapsed < def.waveTransitionTicks) return;

  // Spawn the wave.
  const waveDef = def.waves[ds.currentWaveIndex];
  if (!waveDef) {
    // No more waves — should not happen here, but guard.
    enterCompleted(activity, ds, ctx, params);
    return;
  }

  spawnDungeonWave(waveDef, ds, session, ctx);
  openPartyBattle(activity, ds, session, ctx, params);
}

// --- fighting ---

function stepFighting(
  activity: DungeonActivity,
  ds: DungeonSession,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const battle = findBattle(activity, ctx.state);
  if (!battle) {
    // Battle lost — treat as internal error, fail the dungeon.
    enterFailed(activity, ds, ctx, params);
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

  // Battle resolved.
  removeBattle(ctx.state, battle.id);
  activity.currentBattleId = null;

  const session = ctx.state.stages[ds.stageId];
  if (session?.currentWave?.status === "active") {
    session.currentWave.status =
      battle.outcome === "players_won" ? "victory" : "defeat";
  }

  if (battle.outcome === "players_won") {
    activity.phase = "waveCleared";
    activity.transitionTick = ctx.currentTick;
    syncDungeonToState(activity, ds);
  } else {
    enterFailed(activity, ds, ctx, params);
  }
}

// --- waveCleared ---

function stepWaveCleared(
  activity: DungeonActivity,
  ds: DungeonSession,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const def = getDungeon(ds.dungeonId);
  const session = ctx.state.stages[ds.stageId];

  // Grant wave rewards to all party members.
  if (session?.currentWave && !session.currentWave.rewardGranted) {
    const waveDef = def.waves[ds.currentWaveIndex];
    if (waveDef?.rewards) {
      grantDungeonWaveRewards(ds, waveDef.rewards, session, ctx);
    }
    session.currentWave.rewardGranted = true;
  }

  // Clean up current wave enemies.
  if (session?.currentWave) {
    clearWaveEnemies(session, ctx);
    session.currentWave = null;
  }

  ctx.bus.emit("dungeonWaveCleared", {
    dungeonSessionId: activity.dungeonSessionId,
    dungeonId: ds.dungeonId,
    waveIndex: ds.currentWaveIndex,
  });

  // Advance to next wave or complete.
  const nextIndex = ds.currentWaveIndex + 1;
  if (nextIndex >= def.waves.length) {
    // All waves cleared — grant completion rewards and finish.
    if (def.completionRewards) {
      grantDungeonWaveRewards(ds, def.completionRewards, session!, ctx);
    }
    enterCompleted(activity, ds, ctx, params);
    return;
  }

  ds.currentWaveIndex = nextIndex;

  // Check if party needs recovery.
  if (partyNeedsRecovery(ds, def, ctx)) {
    activity.phase = "recovering";
    activity.transitionTick = ctx.currentTick;
    syncDungeonToState(activity, ds);
  } else {
    activity.phase = "spawningWave";
    activity.transitionTick = ctx.currentTick;
    syncDungeonToState(activity, ds);
  }
}

// --- recovering ---

function stepRecovering(
  activity: DungeonActivity,
  ds: DungeonSession,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const heroes = getPartyHeroes(ds, ctx.state);
  if (heroes.length === 0) {
    enterFailed(activity, ds, ctx, params);
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
    activity.phase = "spawningWave";
    activity.transitionTick = ctx.currentTick;
    syncDungeonToState(activity, ds);
  }
}

// ---------- Terminal states ----------

function enterCompleted(
  activity: DungeonActivity,
  ds: DungeonSession,
  ctx: ActivityContext,
  params: StepParams,
): void {
  activity.phase = "completed";
  ds.status = "completed";
  syncDungeonToState(activity, ds);
  disposeKillListener(activity);
  ctx.bus.emit("dungeonCompleted", {
    dungeonSessionId: activity.dungeonSessionId,
    dungeonId: ds.dungeonId,
  });
  params.restoreParty(ctx);
}

function enterFailed(
  activity: DungeonActivity,
  ds: DungeonSession,
  ctx: ActivityContext,
  params: StepParams,
): void {
  activity.phase = "failed";
  ds.status = "failed";
  syncDungeonToState(activity, ds);
  disposeKillListener(activity);
  ctx.bus.emit("dungeonFailed", {
    dungeonSessionId: activity.dungeonSessionId,
    dungeonId: ds.dungeonId,
    waveIndex: ds.currentWaveIndex,
  });
  params.restoreParty(ctx);
}

/** Called externally by Session.abandonDungeon(). */
export function abandonDungeon(
  activity: DungeonActivity,
  ds: DungeonSession,
  ctx: ActivityContext,
  restoreParty: (ctx: ActivityContext) => void,
): void {
  // If currently in a battle, end it.
  if (activity.currentBattleId) {
    removeBattle(ctx.state, activity.currentBattleId);
    activity.currentBattleId = null;
  }
  activity.phase = "abandoned";
  ds.status = "abandoned";
  syncDungeonToState(activity, ds);
  disposeKillListener(activity);
  ctx.bus.emit("dungeonAbandoned", {
    dungeonSessionId: activity.dungeonSessionId,
    dungeonId: ds.dungeonId,
  });
  restoreParty(ctx);
}

// ---------- Wave spawning ----------

function spawnDungeonWave(
  waveDef: DungeonWaveDef,
  ds: DungeonSession,
  session: StageSession,
  ctx: ActivityContext,
): void {
  session.combatWaveIndex += 1;
  const enemyIds: string[] = [];

  for (let i = 0; i < waveDef.monsters.length; i++) {
    const monsterId = waveDef.monsters[i]!;
    const mdef = getMonster(monsterId);
    const instanceId = mintMonsterInstanceId(ctx.state, mdef.id);
    const enemy = createEnemy({
      instanceId,
      def: mdef,
      attrDefs: ctx.attrDefs,
    });
    ctx.state.actors.push(enemy);
    session.spawnedActorIds.push(instanceId);
    enemyIds.push(instanceId);
  }

  session.currentWave = {
    combatZoneId: ds.dungeonId, // overloaded: stores dungeonId for dungeon waves
    dungeonId: ds.dungeonId,
    waveId: waveDef.id,
    waveIndex: ds.currentWaveIndex,
    enemyIds,
    status: "active",
    rewardGranted: false,
  };
  session.pendingCombatWaveSearch = null;
}

// ---------- Battle management ----------

function openPartyBattle(
  activity: DungeonActivity,
  ds: DungeonSession,
  session: StageSession,
  ctx: ActivityContext,
  params: StepParams,
): void {
  const heroes = getPartyHeroes(ds, ctx.state);
  const enemies = stageEnemies(session, ctx.state).filter(
    (e) => e.currentHp > 0,
  );

  if (enemies.length === 0 || heroes.length === 0) {
    enterFailed(activity, ds, ctx, params);
    return;
  }

  const allParticipants = [...heroes, ...enemies];
  const intents = buildBattleIntents(allParticipants);

  if (!session.currentWave) {
    throw new Error(`dungeon.openPartyBattle: stage "${ds.stageId}" has enemies but no active wave`);
  }

  const battleId = mintBattleId(ctx.state);
  const battle = createBattle({
    id: battleId,
    mode: heroes.length > 1 ? "party" : "solo",
    participantIds: [...heroes.map((h) => h.id), ...enemies.map((e) => e.id)],
    startedAtTick: ctx.currentTick,
    intents,
    metadata: {
      stageId: ds.stageId,
      locationId: session.locationId,
      dungeonSessionId: activity.dungeonSessionId,
      dungeonId: ds.dungeonId,
      combatZoneId: session.currentWave.combatZoneId,
      waveId: session.currentWave.waveId,
      waveIndex: session.currentWave.waveIndex,
      partyCharIds: ds.partyCharIds.slice(),
    },
  });
  ctx.state.battles.push(battle);
  activity.currentBattleId = battle.id;
  activity.phase = "fighting";
  activity.transitionTick = ctx.currentTick;
  syncDungeonToState(activity, ds);
  ctx.bus.emit("battleStarted", {
    battleId: battle.id,
    stageId: ds.stageId,
    locationId: session.locationId,
    participantIds: battle.participantIds.slice(),
    partyCharIds: ds.partyCharIds.slice(),
    combatZoneId: session.currentWave.combatZoneId,
    waveId: session.currentWave.waveId,
    waveIndex: session.currentWave.waveIndex,
    dungeonSessionId: activity.dungeonSessionId,
    dungeonId: ds.dungeonId,
  });
}


function findBattle(
  activity: DungeonActivity,
  state: GameState,
): Battle | null {
  if (!activity.currentBattleId) return null;
  return (
    state.battles.find((b) => b.id === activity.currentBattleId) ?? null
  );
}

function removeBattle(state: GameState, battleId: string): void {
  state.battles = state.battles.filter((b) => b.id !== battleId);
}

// ---------- Rewards ----------

function onParticipantKilled(
  activity: DungeonActivity,
  victimId: string,
  ctx: ActivityContext,
): void {
  const battle = findBattle(activity, ctx.state);
  if (!battle) return;
  if (!battle.participantIds.includes(victimId)) return;

  const victim = ctx.state.actors.find((a) => a.id === victimId);
  if (!victim || !isEnemy(victim)) return;

  const ds = ctx.state.dungeons[activity.dungeonSessionId];
  if (!ds) return;

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

  const heroes = getPartyHeroes(ds, ctx.state);
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
    id: `effect.runtime.dungeon_kill_reward.${enemy.defId}` as never,
    kind: "instant" as const,
    rewards: {
      charXp: splitXp,
      currencies: splitCurrencies,
    },
  };

  for (const hero of living) {
    applyEffect(splitEffect, victim, hero, ectx);
  }

  const items: { itemId: ItemId; qty: number }[] = [];
  for (const drop of def.drops) {
    if (!ctx.rng.chance(drop.chance)) continue;
    const qty = ctx.rng.int(drop.minQty, drop.maxQty);
    if (qty > 0) items.push({ itemId: drop.itemId, qty });
  }
  if (items.length > 0) {
    const lucky = ctx.rng.pick(living);
    const itemEffect: EffectDef = {
      id: `effect.runtime.dungeon_kill_reward.items.${enemy.defId}` as never,
      kind: "instant",
      rewards: { items },
    };
    applyEffect(itemEffect, victim, lucky, ectx);
  }
}

function grantDungeonWaveRewards(
  ds: DungeonSession,
  rewards: WaveRewardDef,
  session: StageSession,
  ctx: ActivityContext,
): void {
  const heroes = getPartyHeroes(ds, ctx.state);
  const living = heroes.filter((h) => h.currentHp > 0);
  if (living.length === 0) return;

  const ectx: EffectContext = {
    state: ctx.state,
    bus: ctx.bus,
    rng: ctx.rng,
    attrDefs: ctx.attrDefs,
    currentTick: ctx.currentTick,
    currencyChangeSource: "dungeon_reward",
  };

  // Items: roll once, give to a random living hero.

  const items: { itemId: ItemId; qty: number }[] = [];
  for (const drop of rewards.drops ?? []) {
    if (!ctx.rng.chance(drop.chance)) continue;
    const qty = ctx.rng.int(drop.minQty, drop.maxQty);
    if (qty > 0) items.push({ itemId: drop.itemId, qty });
  }
  if (items.length > 0) {
    const lucky = ctx.rng.pick(living);
    const itemEffect: EffectDef = {
      id: `effect.runtime.dungeon_wave_reward.items.${session.locationId}.${ds.currentWaveIndex}` as never,
      kind: "instant",
      rewards: { items },
    };
    applyEffect(itemEffect, lucky, lucky, ectx);
  }

  // Currencies: split evenly across living heroes.
  const hasCurrencies = !!rewards.currencies && Object.keys(rewards.currencies).length > 0;
  if (hasCurrencies) {
    const share = living.length;
    const splitCurrencies = Object.fromEntries(
      Object.entries(rewards.currencies!).map(([k, v]) => [k, Math.max(1, Math.floor(v / share))]),
    );
    const currencyEffect: EffectDef = {
      id: `effect.runtime.dungeon_wave_reward.currency.${session.locationId}.${ds.currentWaveIndex}` as never,
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
  ds: DungeonSession,
  state: GameState,
): PlayerCharacter[] {
  const result: PlayerCharacter[] = [];
  for (const charId of ds.partyCharIds) {
    const actor = state.actors.find((a) => a.id === charId);
    if (actor && isPlayer(actor)) result.push(actor as PlayerCharacter);
  }
  return result;
}

function partyNeedsRecovery(
  ds: DungeonSession,
  def: DungeonDef,
  ctx: ActivityContext,
): boolean {
  const threshold = def.recoverBelowHpFactor;
  if (threshold <= 0) return false;
  const heroes = getPartyHeroes(ds, ctx.state);
  for (const hero of heroes) {
    if (hero.currentHp <= 0) return true;
    const maxHp = getAttr(hero, ATTR.MAX_HP, ctx.attrDefs);
    if (maxHp > 0 && hero.currentHp / maxHp <= threshold) return true;
  }
  return false;
}

function clearWaveEnemies(
  session: StageSession,
  ctx: ActivityContext,
): void {
  const wave = session.currentWave;
  if (!wave || wave.enemyIds.length === 0) return;
  const enemyIds = new Set(wave.enemyIds);
  ctx.state.actors = ctx.state.actors.filter((a) => !enemyIds.has(a.id));
  session.spawnedActorIds = session.spawnedActorIds.filter(
    (id) => !enemyIds.has(id),
  );
  wave.enemyIds = [];
}

function syncDungeonToState(
  activity: DungeonActivity,
  ds: DungeonSession,
): void {
  // The DungeonSession in GameState IS the persisted state. WorldActivityState
  // is not used for dungeons — DungeonSession is the source of truth.
  // We keep the phase on the DungeonSession for save/load (through ds.status
  // for terminal states; non-terminal phases are implied by ds state).
  void activity;
  void ds;
}

function disposeKillListener(activity: DungeonActivity): void {
  const dispose = (activity as unknown as { __disposeKill?: () => void })
    .__disposeKill;
  if (dispose) dispose();
}
