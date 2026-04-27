#!/usr/bin/env bun

import { setContent, getContent } from "../src/core/content";
import { buildDefaultContent } from "../src/content/default/build-default-content";
import { createRng } from "../src/core/infra/rng";
import { createGameEventBus } from "../src/core/infra/events";
import { createEmptyState } from "../src/core/infra/state";
import type { GameState } from "../src/core/infra/state/types";
import { createBattle, tickBattle } from "../src/core/combat/battle";
import { isAlive } from "../src/core/entity/actor";
import type { PlayerCharacter, Enemy } from "../src/core/entity/actor/types";
import { createPlayerCharacter, createEnemy } from "../src/core/entity/actor/factory";
import { getMonster } from "../src/core/content/registry";
import { INTENT } from "../src/core/combat/intent";
import { registerBuiltinIntents } from "../src/core/combat/intent";
import { ATTR } from "../src/core/entity/attribute";
import { heroConfigs } from "../src/content/default/heroes";

interface BattleResult {
  outcome: "players_won" | "enemies_won" | "draw";
  ticks: number;
  playerHpRemaining: number;
  enemyHpRemaining: number;
  playerHpMax: number;
  enemyHpMax: number;
  damageDoneToEnemy: number;
  damageDoneToPlayer: number;
}

interface SimulationStats {
  totalRuns: number;
  wins: number;
  losses: number;
  draws: number;
  avgTicksToWin: number;
  winRate: number;
  avgPlayerHpAtWin: number;
  avgDamageDealt: number;
  avgDamageTaken: number;
}

function initializeContent() {
  setContent(buildDefaultContent());
  registerBuiltinIntents();
}

function freshState(seed: number): GameState {
  return createEmptyState(seed, 1);
}

function testIntents(...ids: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const id of ids) {
    m[id] = INTENT.PRIORITY_LIST;
  }
  return m;
}

function runSingleBattle(
  heroId: string,
  heroConfig: any,
  monsterDef: any,
  seed: number,
  verbose: boolean = false
): BattleResult {
  const state = freshState(seed);
  const bus = createGameEventBus();
  const rng = createRng(seed);

  const player = createPlayerCharacter({
    id: `player_${seed}`,
    name: heroConfig.name,
    heroConfigId: heroId,
    baseAttrs: heroConfig.baseAttrs,
    knownTalents: heroConfig.knownTalents || [],
  });

  const enemy = createEnemy({
    instanceId: `enemy_${seed}`,
    def: monsterDef,
    side: "enemy",
  });

  state.actors = [player, enemy];

  const battle = createBattle({
    id: `battle_${seed}`,
    mode: "solo",
    participantIds: [player.id, enemy.id],
    startedAtTick: 0,
    intents: testIntents(player.id, enemy.id),
  });

  const playerHpMax = player.currentHp;
  const enemyHpMax = enemy.currentHp;
  let tick = 0;
  const maxTicks = 2000;

  while (battle.outcome === "ongoing" && tick < maxTicks) {
    tick += 1;
    tickBattle(battle, { state, bus, rng, currentTick: tick });
  }

  const damageDoneToEnemy = enemyHpMax - Math.max(0, enemy.currentHp);
  const damageDoneToPlayer = playerHpMax - Math.max(0, player.currentHp);

  if (verbose) {
    console.log(`  Outcome: ${battle.outcome}`);
    console.log(`  Ticks: ${tick}`);
    console.log(`  Player HP: ${Math.max(0, player.currentHp)}/${playerHpMax}`);
    console.log(`  Enemy HP: ${Math.max(0, enemy.currentHp)}/${enemyHpMax}`);
    console.log(
      `  Damage dealt: ${damageDoneToEnemy}, taken: ${damageDoneToPlayer}`
    );
  }

  return {
    outcome: battle.outcome as "players_won" | "enemies_won" | "draw",
    ticks: tick,
    playerHpRemaining: Math.max(0, player.currentHp),
    enemyHpRemaining: Math.max(0, enemy.currentHp),
    playerHpMax,
    enemyHpMax,
    damageDoneToEnemy,
    damageDoneToPlayer,
  };
}

function cmdBattle(heroId: string, monsterId: string, options: any) {
  console.log(`\n=== Single Battle: ${heroId} vs ${monsterId} ===\n`);

  const seed = options.seed || 42;
  const verbose = options.verbose !== false;

  try {
    initializeContent();

    const heroConfig = heroConfigs[heroId as keyof typeof heroConfigs];
    if (!heroConfig) {
      console.error(`Hero "${heroId}" not found`);
      console.log("Available heroes:", Object.keys(heroConfigs).filter((k) => !k.includes("template")));
      process.exit(1);
    }

    const monsterDef = getMonster(monsterId);
    if (!monsterDef) {
      console.error(`Monster "${monsterId}" not found`);
      process.exit(1);
    }

    const result = runSingleBattle(heroId, heroConfig, monsterDef, seed, verbose);

    console.log("\n" + "=".repeat(50));
    if (result.outcome === "players_won") {
      console.log("PLAYER VICTORY");
    } else if (result.outcome === "enemies_won") {
      console.log("PLAYER DEFEAT");
    } else {
      console.log("DRAW");
    }
    console.log("=".repeat(50));
  } catch (error) {
    console.error("Error running battle:", error);
    process.exit(1);
  }
}

function cmdSimulate(heroId: string, monsterId: string, options: any) {
  const runs = options.runs || 100;
  const seed = options.seed || 42;

  console.log(
    `\n=== Simulation: ${heroId} vs ${monsterId} (${runs} runs) ===\n`
  );

  try {
    initializeContent();

    const heroConfig = heroConfigs[heroId as keyof typeof heroConfigs];
    if (!heroConfig) {
      console.error(`Hero "${heroId}" not found`);
      process.exit(1);
    }

    const monsterDef = getMonster(monsterId);
    if (!monsterDef) {
      console.error(`Monster "${monsterId}" not found`);
      process.exit(1);
    }

    const results: BattleResult[] = [];
    for (let i = 0; i < runs; i++) {
      results.push(runSingleBattle(heroId, heroConfig, monsterDef, seed + i, false));
    }

    const stats = computeStats(results);
    printStats(stats);
  } catch (error) {
    console.error("Error running simulation:", error);
    process.exit(1);
  }
}

function cmdCompare(
  hero1Id: string,
  hero2Id: string,
  monsterId: string,
  options: any
) {
  const runs = options.runs || 50;
  const seed = options.seed || 42;

  console.log(
    `\n=== Comparison: ${hero1Id} vs ${hero2Id} against ${monsterId} (${runs} runs each) ===\n`
  );

  try {
    initializeContent();

    const hero1Config = heroConfigs[hero1Id as keyof typeof heroConfigs];
    const hero2Config = heroConfigs[hero2Id as keyof typeof heroConfigs];
    const monsterDef = getMonster(monsterId);

    if (!hero1Config || !hero2Config || !monsterDef) {
      console.error("One or more entities not found");
      process.exit(1);
    }

    const results1: BattleResult[] = [];
    for (let i = 0; i < runs; i++) {
      results1.push(runSingleBattle(hero1Id, hero1Config, monsterDef, seed + i, false));
    }

    const results2: BattleResult[] = [];
    for (let i = 0; i < runs; i++) {
      results2.push(runSingleBattle(hero2Id, hero2Config, monsterDef, seed + 1000 + i, false));
    }

    const stats1 = computeStats(results1);
    const stats2 = computeStats(results2);

    console.log(`\n${hero1Id}:`);
    printStats(stats1);
    console.log(`\n${hero2Id}:`);
    printStats(stats2);

    console.log("\n" + "=".repeat(50));
    console.log("Comparison:");
    console.log(
      `  Win Rate Diff: ${(stats1.winRate - stats2.winRate).toFixed(1)}%`
    );
    console.log(
      `  Avg Damage Diff: ${(stats1.avgDamageDealt - stats2.avgDamageDealt).toFixed(1)}`
    );
  } catch (error) {
    console.error("Error running comparison:", error);
    process.exit(1);
  }
}

function cmdList() {
  try {
    initializeContent();
    const content = getContent();

    console.log("\nAvailable Heroes:");
    Object.keys(heroConfigs)
      .filter((k) => !k.includes("template"))
      .forEach((id) => {
        const hero = heroConfigs[id as keyof typeof heroConfigs];
        if (hero) console.log(`  ${id}: ${hero.name}`);
      });

    console.log("\nAvailable Monsters:");
    Object.keys(content.monsters)
      .sort()
      .slice(0, 20)
      .forEach((id) => {
        const m = content.monsters[id];
        if (m) {
          const hp = m.baseAttrs[ATTR.MAX_HP] || 0;
          const atk = m.baseAttrs[ATTR.PATK] || 0;
          console.log(`  ${id}: ${m.name} (HP: ${hp}, ATK: ${atk})`);
        }
      });
    const remaining = Math.max(0, Object.keys(content.monsters).length - 20);
    if (remaining > 0) {
      console.log(`  ... and ${remaining} more`);
    }
  } catch (error) {
    console.error("Error listing content:", error);
    process.exit(1);
  }
}

function computeStats(results: BattleResult[]): SimulationStats {
  const wins = results.filter((r) => r.outcome === "players_won").length;
  const losses = results.filter((r) => r.outcome === "enemies_won").length;
  const draws = results.filter((r) => r.outcome === "draw").length;

  const winResults = results.filter((r) => r.outcome === "players_won");
  const avgTicksToWin =
    winResults.length > 0
      ? winResults.reduce((s, r) => s + r.ticks, 0) / winResults.length
      : 0;

  const avgDamageDealt = results.reduce((s, r) => s + r.damageDoneToEnemy, 0) / results.length;
  const avgDamageTaken = results.reduce((s, r) => s + r.damageDoneToPlayer, 0) / results.length;

  return {
    totalRuns: results.length,
    wins,
    losses,
    draws,
    avgTicksToWin,
    winRate: (wins / results.length) * 100,
    avgPlayerHpAtWin: 0,
    avgDamageDealt,
    avgDamageTaken,
  };
}

function printStats(stats: SimulationStats) {
  console.log("Results:");
  console.log(`  Wins: ${stats.wins}/${stats.totalRuns} (${stats.winRate.toFixed(1)}%)`);
  console.log(`  Losses: ${stats.losses}/${stats.totalRuns}`);
  console.log(`  Draws: ${stats.draws}/${stats.totalRuns}`);
  console.log(`  Avg ticks to win: ${stats.avgTicksToWin.toFixed(1)}`);
  console.log(`  Avg damage dealt: ${stats.avgDamageDealt.toFixed(1)}`);
  console.log(`  Avg damage taken: ${stats.avgDamageTaken.toFixed(1)}`);
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
Balance Testing CLI for YAIA

Usage:
  bun run scripts/sim.ts battle <heroId> <monsterId> [--seed 42]
  bun run scripts/sim.ts simulate <heroId> <monsterId> [--runs 100] [--seed 42]
  bun run scripts/sim.ts compare <hero1> <hero2> <monster> [--runs 50] [--seed 42]
  bun run scripts/sim.ts list|ls              # List available heroes and monsters

Examples:
  bun run scripts/sim.ts battle hero.knight monster.slime
  bun run scripts/sim.ts simulate hero.knight monster.slime --runs 50
  bun run scripts/sim.ts compare hero.knight hero.ranger monster.slime
  bun run scripts/sim.ts list
  `);
  process.exit(0);
}

const command = args[0];

try {
  switch (command) {
    case "battle":
      if (args.length < 3) throw new Error("battle requires heroId and monsterId");
      cmdBattle(args[1], args[2], { seed: 42, verbose: true });
      break;

    case "simulate":
      if (args.length < 3) throw new Error("simulate requires heroId and monsterId");
      const simSeed = parseInt(
        args.find((a, i) => args[i - 1] === "--seed")?.toString() || "42"
      );
      const simRuns = parseInt(
        args.find((a, i) => args[i - 1] === "--runs")?.toString() || "100"
      );
      cmdSimulate(args[1], args[2], { runs: simRuns, seed: simSeed });
      break;

    case "compare":
      if (args.length < 4) throw new Error("compare requires two heroes and a monster");
      const compSeed = parseInt(
        args.find((a, i) => args[i - 1] === "--seed")?.toString() || "42"
      );
      const compRuns = parseInt(
        args.find((a, i) => args[i - 1] === "--runs")?.toString() || "50"
      );
      cmdCompare(args[1], args[2], args[3], { runs: compRuns, seed: compSeed });
      break;

    case "list":
    case "ls":
      cmdList();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
} catch (error) {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
}
