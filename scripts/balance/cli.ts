#!/usr/bin/env bun

// Balance testing CLI entry point.
//
// All game logic flows through GameSession — no combat rules are duplicated.
// Uses commander for argument parsing.
// Simulation length defaults to 60 simulated minutes (1 hour of AFK farming).

import { Command } from "commander";
import { buildDefaultContent } from "../../src/content/default/build-default-content";
import {
  loadConfigFile,
  loadProfilesFile,
  validateConfig,
  validateProfiles,
  resolveScenarios,
  buildQuickConfig,
  buildCliConfig,
  type BalanceConfig,
} from "./config";
import { runSimulation } from "./simulate";
import { computeStats, type SimStats } from "./stats";
import {
  printScenarioTable,
  printDetailedResult,
  printJson,
  writeHtmlReport,
} from "./report";

// ---------- Program ----------

const parseIntArg = (v: string) => parseInt(v, 10);

const program = new Command()
  .name("balance")
  .description("Game balance testing CLI — headless combat simulation")
  .version("0.1.0");

interface RunCommandOptions {
  profile?: string[];
  zone?: string[];
  scenario?: string;
  duration?: number;
  seed?: number;
  json?: boolean;
  html?: string;
}

interface QuickCommandOptions {
  level: number;
  weapon?: string;
  duration: number;
  seed: number;
  json?: boolean;
  html?: string;
}

function quotePowerShellArg(arg: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "''")}'`;
}

function joinCommand(parts: string[]): string {
  return parts.map(quotePowerShellArg).join(" ");
}

function buildRunCommand(file: string, opts: RunCommandOptions): string {
  const parts = ["bun", "run", "scripts/balance/cli.ts", "run", file];
  if (opts.profile?.length) parts.push("-p", ...opts.profile);
  if (opts.zone?.length) parts.push("-z", ...opts.zone);
  if (opts.scenario) parts.push("-s", opts.scenario);
  if (typeof opts.duration === "number") parts.push("-d", String(opts.duration));
  if (typeof opts.seed === "number") parts.push("--seed", String(opts.seed));
  if (opts.json) parts.push("--json");
  if (opts.html) parts.push("--html", opts.html);
  return joinCommand(parts);
}

function buildQuickCommand(
  heroId: string,
  zoneId: string,
  opts: QuickCommandOptions,
): string {
  const parts = ["bun", "run", "scripts/balance/cli.ts", "quick", heroId, zoneId];
  if (typeof opts.level === "number") parts.push("-l", String(opts.level));
  if (opts.weapon) parts.push("--weapon", opts.weapon);
  if (typeof opts.duration === "number") parts.push("-d", String(opts.duration));
  if (typeof opts.seed === "number") parts.push("--seed", String(opts.seed));
  if (opts.json) parts.push("--json");
  if (opts.html) parts.push("--html", opts.html);
  return joinCommand(parts);
}

// ---------- run ----------

program
  .command("run <file>")
  .description("Run simulations from a profiles file (with -p/-z globs) or a full config file")
  .option("-p, --profile <glob...>", "profile key globs (repeatable, * = wildcard)")
  .option("-z, --zone <glob...>", "combat zone ID globs (repeatable, * = wildcard)")
  .option("-s, --scenario <filter>", "only run scenarios whose name contains this string")
  .option("-d, --duration <minutes>", "simulated duration in minutes (default 60)", parseIntArg)
  .option("--seed <n>", "RNG seed", parseIntArg)
  .option("--json", "output raw JSON instead of tables")
  .option("--html <path>", "write an interactive standalone HTML report")
  .action(async (file: string, opts: RunCommandOptions) => {
    const content = buildDefaultContent();
    let config: BalanceConfig;

    if (opts.profile?.length && opts.zone?.length) {
      const pf = await loadProfilesFile(file);
      const errors = validateProfiles(pf.heroProfiles, content);
      if (errors.length > 0) {
        console.error("Profile validation errors:");
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }
      config = buildCliConfig(pf.heroProfiles, {
        profileGlobs: opts.profile,
        zoneGlobs: opts.zone,
        durationMinutes: opts.duration,
        seed: opts.seed,
      });
    } else {
      config = await loadConfigFile(file);
      if (opts.duration) (config.defaults ??= {}).durationMinutes = opts.duration;
      if (opts.seed) config.seed = opts.seed;
    }

    const errors = validateConfig(config, content);
    if (errors.length > 0) {
      console.error("Config validation errors:");
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }

    let scenarios = resolveScenarios(config, content);
    const scenarioFilter = opts.scenario;
    if (scenarioFilter) {
      scenarios = scenarios.filter((s) => s.name.includes(scenarioFilter));
      if (scenarios.length === 0) {
        console.error(`No scenarios matched filter "${scenarioFilter}"`);
        process.exit(1);
      }
    }

    const allResults: SimStats[] = [];

    for (const scenario of scenarios) {
      const scenarioResults: SimStats[] = [];

      for (let pi = 0; pi < scenario.profiles.length; pi++) {
        const { key, profile } = scenario.profiles[pi]!;
        const simSeed = scenario.seed + pi;

        const collector = runSimulation({
          content,
          profileKey: key,
          profile,
          combatZoneId: scenario.combatZoneId,
          totalTicks: scenario.totalTicks,
          seed: simSeed,
        });

        const stats = computeStats(collector);
        scenarioResults.push(stats);
        allResults.push(stats);
      }

      if (!opts.json) {
        printScenarioTable(scenario.name, scenarioResults);
      }
    }

    if (opts.json) {
      printJson(allResults);
    }

    if (opts.html) {
      const outputPath = await writeHtmlReport(allResults, opts.html, {
        title: `Balance Report · ${file}`,
        zoneNames: Object.fromEntries(
          Object.entries(content.combatZones).map(([zoneId, zone]) => [zoneId, zone.name]),
        ),
        rerunCommand: buildRunCommand(file, opts),
      });
      console.log(`HTML report written to ${outputPath}`);
    }
  });

// ---------- quick ----------

program
  .command("quick <heroId> <zoneId>")
  .description("Quick single-profile simulation")
  .option("-l, --level <n>", "target hero level", parseIntArg, 1)
  .option("--weapon <itemId>", "equip a weapon")
  .option("-d, --duration <minutes>", "simulated duration in minutes", parseIntArg, 60)
  .option("--seed <n>", "RNG seed", parseIntArg, 42)
  .option("--json", "output raw JSON")
  .option("--html <path>", "write an interactive standalone HTML report")
  .action(async (heroId: string, zoneId: string, opts: QuickCommandOptions) => {
    const content = buildDefaultContent();
    const config = buildQuickConfig({
      heroId,
      combatZoneId: zoneId,
      level: opts.level,
      weapon: opts.weapon,
      durationMinutes: opts.duration,
      seed: opts.seed,
    });

    const errors = validateConfig(config, content);
    if (errors.length > 0) {
      console.error("Validation errors:");
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }

    const scenarios = resolveScenarios(config, content);
    const scenario = scenarios[0]!;
    const { key, profile } = scenario.profiles[0]!;

    const collector = runSimulation({
      content,
      profileKey: key,
      profile,
      combatZoneId: scenario.combatZoneId,
      totalTicks: scenario.totalTicks,
      seed: scenario.seed,
    });

    const stats = computeStats(collector);

    if (opts.json) {
      printJson([stats]);
    } else {
      printDetailedResult(stats);
    }

    if (opts.html) {
      const outputPath = await writeHtmlReport([stats], opts.html, {
        title: `${heroId} vs ${zoneId}`,
        zoneNames: Object.fromEntries(
          Object.entries(content.combatZones).map(([combatZoneId, zone]) => [combatZoneId, zone.name]),
        ),
        rerunCommand: buildQuickCommand(heroId, zoneId, opts),
      });
      console.log(`HTML report written to ${outputPath}`);
    }
  });

// ---------- list ----------

program
  .command("list [category]")
  .alias("ls")
  .description("List available content IDs (heroes, zones, items, talents, or all)")
  .action((category?: string) => {
    const content = buildDefaultContent();
    const cat = category ?? "all";

    if (cat === "heroes" || cat === "all") {
      console.log("\n  Heroes:");
      for (const hero of content.starting?.heroes ?? []) {
        console.log(`    ${hero.id}: ${hero.name}`);
      }
    }

    if (cat === "zones" || cat === "all") {
      console.log("\n  Combat Zones:");
      for (const [id, zone] of Object.entries(content.combatZones)) {
        const monsterIds = new Set<string>();
        for (const wave of zone.waves) {
          for (const mId of wave.monsters) monsterIds.add(mId);
        }
        const monsterNames = [...monsterIds]
          .map((mId) => content.monsters[mId]?.name ?? mId)
          .join(", ");
        console.log(`    ${id}: ${zone.name}  [${monsterNames}]`);
      }
    }

    if (cat === "items" || cat === "all") {
      console.log("\n  Weapons & Equipment:");
      for (const [id, item] of Object.entries(content.items)) {
        if (item.slot) {
          const mods = (item.modifiers ?? [])
            .map((m) => `${m.stat} ${m.op === "flat" ? "+" : "x"}${m.value}`)
            .join(", ");
          console.log(`    ${id}: ${item.name}  [${item.slot}] ${mods}`);
        }
      }
    }

    if (cat === "talents" || cat === "all") {
      console.log("\n  Talents:");
      for (const [id, talent] of Object.entries(content.talents)) {
        console.log(
          `    ${id}: ${talent.name}  [${talent.type}] tpCost=${talent.tpCost} maxLv=${talent.maxLevel}`,
        );
      }
    }

    console.log("");
  });

// ---------- Parse ----------

program.parse();
