// Output formatting: terminal tables, JSON export, and HTML report export.
//
// Renders SimStats arrays as either a human-readable comparison table,
// structured JSON for downstream analysis, or a self-contained HTML report.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { renderBalanceHtmlReport, type HtmlReportOptions } from "./report-html";
import type { SimStats } from "./stats";

// ---------- Public API ----------

/** Print a comparison table for a single scenario's results. */
export function printScenarioTable(
  scenarioName: string,
  results: SimStats[],
): void {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`  ${scenarioName}`);
  console.log("=".repeat(80));

  if (results.length === 0) {
    console.log("  (no results)");
    return;
  }

  // Find the first non-empty currency key for the table header.
  const currencyKeys = new Set<string>();
  for (const r of results) {
    for (const k of Object.keys(r.currencyPerMinute)) currencyKeys.add(k);
  }
  // Use first currency (typically "currency.gold") or "gold" as column name.
  const primaryCurrency = [...currencyKeys][0] ?? "";
  const currencyLabel = primaryCurrency
    ? shortCurrencyName(primaryCurrency)
    : "-";

  const cols: Column[] = [
    { header: "Profile", width: 24, align: "left" },
    { header: "胜率", width: 8, align: "right" },
    { header: "DPS", width: 8, align: "right" },
    { header: "受击DPS", width: 8, align: "right" },
    { header: "死亡率", width: 8, align: "right" },
    { header: "波次/分", width: 8, align: "right" },
    { header: "XP/分", width: 8, align: "right" },
    { header: `${currencyLabel}/分`, width: 10, align: "right" },
    { header: "击杀数", width: 8, align: "right" },
    { header: "等级", width: 6, align: "right" },
  ];

  printRow(
    cols,
    cols.map((c) => c.header),
  );
  printSeparator(cols);

  for (const r of results) {
    const currPerMin = primaryCurrency
      ? r.currencyPerMinute[primaryCurrency] ?? 0
      : 0;

    printRow(cols, [
      truncate(r.profileKey, 24),
      `${r.winRate.toFixed(1)}%`,
      r.dps.toFixed(2),
      r.damageTakenPerTick.toFixed(2),
      r.deathRate.toFixed(2),
      r.wavesPerMinute.toFixed(1),
      r.xpPerMinute.toFixed(1),
      currPerMin.toFixed(1),
      String(r.kills),
      String(r.finalLevel),
    ]);
  }

  console.log("");
}

/** Print a single result in detail (for quick mode). */
export function printDetailedResult(result: SimStats): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${result.profileKey} vs ${result.combatZoneId}`);
  console.log("=".repeat(60));

  const minutes = result.minutesElapsed;

  console.log(`  英雄: ${result.heroId} (最终等级 ${result.finalLevel})`);
  console.log(`  模拟时长: ${minutes.toFixed(1)} 分钟 (${result.ticksElapsed} ticks)`);
  console.log("");
  console.log(`  波次: ${result.wavesWon} 胜 / ${result.wavesLost} 败 (共 ${result.totalWaves} 波)`);
  console.log(`  胜率: ${result.winRate.toFixed(1)}%`);
  console.log(`  平均通关 tick: ${result.avgTicksPerWave.toFixed(1)}`);
  console.log(`  波次/分: ${result.wavesPerMinute.toFixed(2)}`);
  console.log("");
  console.log(`  DPS (战斗中): ${result.dps.toFixed(2)}`);
  console.log(`  受击 DPS: ${result.damageTakenPerTick.toFixed(2)}`);
  console.log(`  死亡率: ${result.deathRate.toFixed(2)} 次/波`);
  console.log(`  击杀数: ${result.kills}`);
  console.log(`  XP/分: ${result.xpPerMinute.toFixed(1)}`);
  console.log("");

  if (Object.keys(result.currencyPerMinute).length > 0) {
    console.log("  收益/分:");
    for (const [currId, perMin] of Object.entries(result.currencyPerMinute)) {
      console.log(`    ${shortCurrencyName(currId)}: ${perMin.toFixed(2)}`);
    }
  }

  if (Object.keys(result.itemsDropped).length > 0) {
    console.log("  掉落物品:");
    for (const [itemId, qty] of Object.entries(result.itemsDropped)) {
      console.log(`    ${itemId}: x${qty}`);
    }
  }
  console.log("");
}

/** Print all results as JSON to stdout. */
export function printJson(results: SimStats[]): void {
  console.log(JSON.stringify(results, null, 2));
}

/** Write an interactive standalone HTML report and return its absolute path. */
export async function writeHtmlReport(
  results: SimStats[],
  outputPath: string,
  options: HtmlReportOptions = {},
): Promise<string> {
  const fullOutputPath = resolve(outputPath);
  mkdirSync(dirname(fullOutputPath), { recursive: true });

  const html = renderBalanceHtmlReport(results, options);
  await Bun.write(fullOutputPath, html);

  return fullOutputPath;
}

// ---------- Table helpers ----------

interface Column {
  header: string;
  width: number;
  align: "left" | "right";
}

function printRow(cols: Column[], values: string[]): void {
  const parts = cols.map((col, i) => {
    const val = values[i] ?? "";
    return col.align === "left"
      ? val.padEnd(col.width)
      : val.padStart(col.width);
  });
  console.log("  " + parts.join("  "));
}

function printSeparator(cols: Column[]): void {
  const parts = cols.map((col) => "-".repeat(col.width));
  console.log("  " + parts.join("  "));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 2) + "..";
}

function shortCurrencyName(currId: string): string {
  const parts = currId.split(".");
  return parts[parts.length - 1] ?? currId;
}
