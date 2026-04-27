// Simulation engine: drives a full CombatActivity lifecycle headlessly.
//
// Each call to runSimulation creates an isolated GameSession, configures the
// hero, starts combat, and collects event data for the specified duration.
//
// All game logic flows through the real GameSession / CombatActivity /
// StageController / Battle stack — no combat rules are duplicated here.

import type { ContentDb } from "../../src/core/content";
import { createGameSession } from "../../src/core/session";
import type { HeroProfile } from "./config";
import { setupHero, findLocationForCombatZone } from "./setup";
import { isPlayer, isEnemy } from "../../src/core/entity/actor";
import type { CombatActivity } from "../../src/core/world/activity";

// ---------- Collected raw data ----------

export interface SimCollector {
  profileKey: string;
  heroId: string;
  combatZoneId: string;

  wavesCompleted: number;
  wavesLost: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalHealDone: number;
  /** Times the hero entered deathRecovering phase. */
  deaths: number;
  kills: number;
  totalXpGained: number;
  /** Currency gains keyed by currency id. */
  currencyGains: Record<string, number>;
  itemsDropped: Record<string, number>;
  ticksElapsed: number;
  /** Ticks spent in the "fighting" phase specifically. */
  battleTicks: number;
  /** Per-wave outcome records. */
  waveResults: Array<{ outcome: string; ticks: number }>;
  /** Final hero level after simulation. */
  finalLevel: number;
}

// ---------- Public API ----------

export interface SimulationOptions {
  content: ContentDb;
  profileKey: string;
  profile: HeroProfile;
  combatZoneId: string;
  /** Total ticks to simulate. */
  totalTicks: number;
  seed: number;
}

export function runSimulation(opts: SimulationOptions): SimCollector {
  const { content, profileKey, profile, combatZoneId, totalTicks, seed } = opts;

  // 1) Create an isolated session.
  const session = createGameSession({ content, seed });
  // Pause the real-time loop — we drive manually via engine.step().
  session.setSpeedMultiplier(0);
  session.resetToFresh();

  const heroId = profile.heroId;
  const cc = session.getCharacter(heroId);

  // 2) Configure the hero.
  setupHero(session, profile);

  // 3) Enter location & start combat.
  const locationId = findLocationForCombatZone(combatZoneId, content);
  cc.enterLocation(locationId);
  cc.startFight(combatZoneId);

  // 4) Set up event collectors.
  const collector = createCollector(profileKey, heroId, combatZoneId);

  let lastWaveStartTick = session.engine.currentTick;
  let wasDeathRecovering = false;

  const disposers: Array<() => void> = [];

  disposers.push(
    session.bus.on("damage", (ev) => {
      const attacker = session.state.actors.find((a) => a.id === ev.attackerId);
      const target = session.state.actors.find((a) => a.id === ev.targetId);
      if (attacker && isPlayer(attacker)) {
        collector.totalDamageDealt += ev.amount;
      }
      if (target && isPlayer(target)) {
        collector.totalDamageTaken += ev.amount;
      }
    }),
  );

  disposers.push(
    session.bus.on("heal", (ev) => {
      const target = session.state.actors.find((a) => a.id === ev.targetId);
      if (target && isPlayer(target)) {
        collector.totalHealDone += ev.amount;
      }
    }),
  );

  disposers.push(
    session.bus.on("kill", (ev) => {
      const victim = session.state.actors.find((a) => a.id === ev.victimId);
      if (victim && isEnemy(victim)) {
        collector.kills += 1;
      }
    }),
  );

  disposers.push(
    session.bus.on("waveResolved", (ev) => {
      const ticksForWave = session.engine.currentTick - lastWaveStartTick;
      collector.waveResults.push({ outcome: ev.outcome, ticks: ticksForWave });
      if (ev.outcome === "players_won") {
        collector.wavesCompleted += 1;
      } else {
        collector.wavesLost += 1;
      }
      lastWaveStartTick = session.engine.currentTick;
    }),
  );

  disposers.push(
    session.bus.on("currencyChanged", (ev) => {
      if (ev.amount > 0) {
        collector.currencyGains[ev.currencyId] =
          (collector.currencyGains[ev.currencyId] ?? 0) + ev.amount;
      }
    }),
  );

  disposers.push(
    session.bus.on("loot", (ev) => {
      collector.itemsDropped[ev.itemId] =
        (collector.itemsDropped[ev.itemId] ?? 0) + ev.qty;
    }),
  );

  // Record starting XP (should be 0 after setup, but be safe).
  const startingXp = cc.hero.exp;

  // 5) Run the tick loop for the specified duration.
  // Step in chunks for performance (engine.step handles internal loop).
  const CHUNK = 100;
  let ticksRun = 0;

  while (ticksRun < totalTicks) {
    const remaining = totalTicks - ticksRun;
    const step = Math.min(CHUNK, remaining);
    session.engine.step(step);
    ticksRun += step;

    // Track death phase transitions (sample once per chunk — may miss very
    // short phases but acceptable at 100-tick granularity).
    const activity = cc.activity as CombatActivity | null;
    if (activity) {
      const isDeathRecovering = activity.phase === "deathRecovering";
      if (isDeathRecovering && !wasDeathRecovering) {
        collector.deaths += 1;
      }
      wasDeathRecovering = isDeathRecovering;

      if (activity.phase === "stopped") break;
    } else {
      break;
    }
  }

  // Count battle ticks from wave results (more accurate than per-tick sampling).
  // battleTicks = total ticks - time NOT fighting (searching + recovering).
  // Simpler: sum ticks of all wave results (each wave result covers search+fight+recovery).
  // But we want fighting-only ticks, so keep the event-based approach from waveResults.
  // Actually, for DPS we want totalDamage / battleTicks. Let's derive battle ticks
  // from total ticks minus non-fighting overhead. For simplicity, use ticksRun directly
  // in stats — DPS = damage / totalTicks gives "effective DPS including downtime".
  // Keep battleTicks = 0 and let stats compute from totalTicks.

  // 6) Finalize.
  collector.ticksElapsed = ticksRun;
  collector.finalLevel = cc.hero.level;
  collector.totalXpGained = cc.hero.exp - startingXp;

  // Clean up event listeners.
  for (const dispose of disposers) dispose();
  session.dispose();

  return collector;
}

// ---------- Internal ----------

function createCollector(
  profileKey: string,
  heroId: string,
  combatZoneId: string,
): SimCollector {
  return {
    profileKey,
    heroId,
    combatZoneId,
    wavesCompleted: 0,
    wavesLost: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    totalHealDone: 0,
    deaths: 0,
    kills: 0,
    totalXpGained: 0,
    currencyGains: {},
    itemsDropped: {},
    ticksElapsed: 0,
    battleTicks: 0,
    waveResults: [],
    finalLevel: 1,
  };
}
