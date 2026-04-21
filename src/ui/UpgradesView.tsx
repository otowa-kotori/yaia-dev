// Global Upgrades shop tab.
//
// Shows the player's current gold balance, then a card for each UpgradeDef
// in the content db. Cards display:
//   - Upgrade name + description
//   - Current level / max level progress bar
//   - Current total bonus (level × perLevel modifier)
//   - Next-level cost; Buy button disabled when gold is insufficient or maxed
//
// Read/write: reads store.getCurrencies() / getWorldRecord() / listUpgradeIds();
// writes via store.purchaseUpgrade(). No local state beyond hover.

import { getContent } from "../core/content";
import { upgradeCost } from "../core/worldrecord";
import { ATTR } from "../core/attribute";
import type { Modifier } from "../core/content/types";
import type { GameStore } from "./store";
import { useStore } from "./useStore";

// Currency display name map — extend as new currencies are added.
const CURRENCY_NAMES: Record<string, string> = {
  "currency.gold": "金币",
};

export function UpgradesView({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const currencies = s.getCurrencies();
  const worldRecord = s.getWorldRecord();
  const upgradeIds = s.listUpgradeIds();
  const content = getContent();

  const gold = currencies["currency.gold"] ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Currency balance header */}
      <div style={{ background: "#222", borderRadius: 4, padding: "8px 12px", display: "flex", gap: 16 }}>
        {Object.entries(currencies).map(([id, amount]) => (
          <span key={id} style={{ fontSize: 14 }}>
            <span style={{ color: "#f0c040", fontWeight: 600 }}>
              {CURRENCY_NAMES[id] ?? id}
            </span>
            <span style={{ marginLeft: 6, fontVariantNumeric: "tabular-nums" }}>
              {amount}
            </span>
          </span>
        ))}
        {Object.keys(currencies).length === 0 && (
          <span style={{ opacity: 0.45, fontSize: 13 }}>
            尚无货币 — 打怪获得金币！
          </span>
        )}
      </div>

      {/* Upgrade cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {upgradeIds.map((id) => {
          const def = content.upgrades[id];
          if (!def) return null;
          const currentLevel = worldRecord.upgrades[id] ?? 0;
          const maxed = currentLevel >= def.maxLevel;
          const cost = maxed ? 0 : upgradeCost(def, currentLevel);
          const canAfford = gold >= cost;

          return (
            <UpgradeCard
              key={id}
              name={def.name}
              description={def.description}
              currentLevel={currentLevel}
              maxLevel={def.maxLevel}
              modifiers={def.modifierPerLevel}
              cost={cost}
              costCurrencyName={CURRENCY_NAMES[def.costCurrency] ?? def.costCurrency}
              maxed={maxed}
              canAfford={canAfford}
              onBuy={() => s.purchaseUpgrade(id)}
            />
          );
        })}
      </div>

      {upgradeIds.length === 0 && (
        <div style={{ opacity: 0.45, fontSize: 13 }}>暂无可用升级。</div>
      )}
    </div>
  );
}

function UpgradeCard({
  name,
  description,
  currentLevel,
  maxLevel,
  modifiers,
  cost,
  costCurrencyName,
  maxed,
  canAfford,
  onBuy,
}: {
  name: string;
  description: string;
  currentLevel: number;
  maxLevel: number;
  modifiers: Modifier[];
  cost: number;
  costCurrencyName: string;
  maxed: boolean;
  canAfford: boolean;
  onBuy: () => void;
}) {
  const pct = maxLevel > 0 ? currentLevel / maxLevel : 0;

  return (
    <div
      style={{
        background: "#222",
        borderRadius: 4,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        border: maxed ? "1px solid #3a6" : "1px solid #333",
      }}
    >
      {/* Name + level */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: maxed ? "#4a9" : "#eee" }}>
          {name}
        </span>
        <span style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>
          Lv {currentLevel} / {maxLevel}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: "#111", borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct * 100}%`,
            background: maxed ? "#3a6" : "#59c",
            transition: "width 150ms",
          }}
        />
      </div>

      {/* Description */}
      <div style={{ fontSize: 12, opacity: 0.7 }}>{description}</div>

      {/* Current bonus summary */}
      {currentLevel > 0 && (
        <div style={{ fontSize: 11, color: "#a9d", opacity: 0.9 }}>
          当前加成：{modifiers.map((m) => formatBonus(m, currentLevel)).join("，")}
        </div>
      )}

      {/* Buy button */}
      {maxed ? (
        <div style={{ fontSize: 12, color: "#4a9", fontWeight: 500, textAlign: "center", marginTop: 2 }}>
          已满级
        </div>
      ) : (
        <button
          onClick={onBuy}
          disabled={!canAfford}
          style={{
            marginTop: 2,
            padding: "5px 10px",
            fontSize: 12,
            borderRadius: 4,
            border: "1px solid #444",
            background: canAfford ? "#2a4a2a" : "#2a2a2a",
            color: canAfford ? "#8d8" : "#666",
            cursor: canAfford ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <span style={{ color: "#f0c040" }}>升级</span>
          <span style={{ opacity: 0.8 }}>—</span>
          <span style={{ fontVariantNumeric: "tabular-nums", color: "#f0c040" }}>{cost}</span>
          <span style={{ opacity: 0.65 }}>{costCurrencyName}</span>
        </button>
      )}
    </div>
  );
}

/** Format a single modifier's total bonus at the given level.
 *  e.g. flat ATK +2 × level 3 → "+6 atk" */
function formatBonus(m: Modifier, level: number): string {
  const statLabel = shortStat(m.stat);
  const total = m.value * level;
  switch (m.op) {
    case "flat": {
      const sign = total >= 0 ? "+" : "";
      return `${sign}${total} ${statLabel}`;
    }
    case "pct_add":
    case "pct_mult": {
      const pct = Math.round(total * 100);
      const sign = pct >= 0 ? "+" : "";
      return `${sign}${pct}% ${statLabel}`;
    }
  }
}

function shortStat(statId: string): string {
  return statId.startsWith("attr.") ? statId.slice(5) : statId;
}
