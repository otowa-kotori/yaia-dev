// Statistics computation from raw simulation data.

import type { SimCollector } from "./simulate";
import { TICKS_PER_MINUTE } from "./config";

// ---------- Types ----------

export interface SimStats {
  profileKey: string;
  heroId: string;
  combatZoneId: string;

  totalWaves: number;
  wavesWon: number;
  wavesLost: number;
  /** Win rate as percentage. */
  winRate: number;

  /** Average ticks per completed (won) wave, including search + recovery. */
  avgTicksPerWave: number;
  /** Waves completed per simulated minute. */
  wavesPerMinute: number;

  /** Damage per tick over the full simulation (effective DPS including downtime). */
  dps: number;
  /** Damage taken per tick over the full simulation. */
  damageTakenPerTick: number;

  /** Deaths per wave (entering deathRecovering phase). */
  deathRate: number;
  kills: number;

  /** XP gained per simulated minute. */
  xpPerMinute: number;
  /** Currency gains per simulated minute (keyed by currency id). */
  currencyPerMinute: Record<string, number>;
  /** Items dropped total. */
  itemsDropped: Record<string, number>;

  /** Total simulation ticks. */
  ticksElapsed: number;
  /** Simulated minutes. */
  minutesElapsed: number;
  /** Final hero level. */
  finalLevel: number;
  /** Carried XP inside the current level at simulation end. */
  finalExp: number;
  /** Total XP required to reach the next level from this level. */
  nextLevelXpCost: number;
  /** Estimated minutes to gain one full level at the current XP/min rate. */
  minutesToNextLevel: number | null;
}

// ---------- Public API ----------

export function computeStats(collector: SimCollector): SimStats {
  const totalWaves = collector.wavesCompleted + collector.wavesLost;
  const minutesElapsed = collector.ticksElapsed / TICKS_PER_MINUTE;

  const wonResults = collector.waveResults.filter(
    (r) => r.outcome === "players_won",
  );
  const avgTicksPerWave =
    wonResults.length > 0
      ? wonResults.reduce((s, r) => s + r.ticks, 0) / wonResults.length
      : 0;

  // Effective DPS: damage over the entire simulation including downtime.
  // This is the number that matters for farming — how much damage you do per
  // unit of wall-clock time, not per unit of active combat time.
  const ticks = collector.ticksElapsed || 1;
  const dps = collector.totalDamageDealt / ticks;
  const damageTakenPerTick = collector.totalDamageTaken / ticks;

  const currencyPerMinute: Record<string, number> = {};
  if (minutesElapsed > 0) {
    for (const [currId, total] of Object.entries(collector.currencyGains)) {
      currencyPerMinute[currId] = total / minutesElapsed;
    }
  }

  const xpPerMinute =
    minutesElapsed > 0 ? collector.totalXpGained / minutesElapsed : 0;
  const minutesToNextLevel = xpPerMinute > 0
    ? collector.nextLevelXpCost / xpPerMinute
    : null;

  return {
    profileKey: collector.profileKey,
    heroId: collector.heroId,
    combatZoneId: collector.combatZoneId,

    totalWaves,
    wavesWon: collector.wavesCompleted,
    wavesLost: collector.wavesLost,
    winRate: totalWaves > 0 ? (collector.wavesCompleted / totalWaves) * 100 : 0,

    avgTicksPerWave,
    wavesPerMinute:
      minutesElapsed > 0 ? collector.wavesCompleted / minutesElapsed : 0,

    dps,
    damageTakenPerTick,

    deathRate: totalWaves > 0 ? collector.deaths / totalWaves : 0,
    kills: collector.kills,

    xpPerMinute,
    currencyPerMinute,
    itemsDropped: { ...collector.itemsDropped },

    ticksElapsed: collector.ticksElapsed,
    minutesElapsed,
    finalLevel: collector.finalLevel,
    finalExp: collector.finalExp,
    nextLevelXpCost: collector.nextLevelXpCost,
    minutesToNextLevel,
  };
}
