// Global Upgrades shop panel.
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

import { getContent } from "../../core/content";
import { upgradeCost } from "../../core/growth/worldrecord";
import { ATTR } from "../../core/entity/attribute";
import type { Modifier } from "../../core/content/types";
import type { GameStore } from "../store";
import { useStore } from "../hooks/useStore";
import { T, currencyName } from "../text";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";

export function UpgradePanel({ store }: { store: GameStore }) {
  const { store: s } = useStore(store);
  const currencies = s.getCurrencies();
  const worldRecord = s.getWorldRecord();
  const upgradeIds = s.listUpgradeIds();
  const content = getContent();

  const gold = currencies["currency.gold"] ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Currency balance header */}
      <Card className="px-3 py-2 flex gap-4">
        {Object.entries(currencies).map(([id, amount]) => (
          <span key={id} className="text-sm">
            <span className="text-yellow-400 font-semibold">
              {currencyName(id)}
            </span>
            <span className="ml-1.5 tabular-nums">
              {amount}
            </span>
          </span>
        ))}
        {Object.keys(currencies).length === 0 && (
          <span className="opacity-45 text-[13px]">
            {T.noCurrencyHint}
          </span>
        )}
      </Card>

      {/* Upgrade cards */}
      <div className="grid grid-cols-2 gap-2">
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
              costCurrencyName={currencyName(def.costCurrency)}
              maxed={maxed}
              canAfford={canAfford}
              onBuy={() => s.purchaseUpgrade(id)}
            />
          );
        })}
      </div>

      {upgradeIds.length === 0 && (
        <div className="opacity-45 text-[13px]">{T.noUpgrades}</div>
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

  const borderClass = maxed ? "border-emerald-600/60" : "border-border";

  return (
    <div className={`bg-surface rounded p-2.5 flex flex-col gap-1.5 border ${borderClass}`}>
      {/* Name + level */}
      <div className="flex justify-between items-baseline">
        <span className={`font-semibold text-[13px] ${maxed ? "text-emerald-400" : "text-gray-100"}`}>
          {name}
        </span>
        <span className="text-[11px] opacity-60 tabular-nums">
          Lv {currentLevel} / {maxLevel}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-[#111] rounded-sm overflow-hidden">
        <div
          className={`h-full transition-[width] duration-150 ${maxed ? "bg-emerald-600" : "bg-blue-500"}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {/* Description */}
      <div className="text-xs opacity-70">{description}</div>

      {/* Current bonus summary */}
      {currentLevel > 0 && (
        <div className="text-[11px] text-purple-300 opacity-90">
          {T.currentBonus}{modifiers.map((m) => formatBonus(m, currentLevel)).join("，")}
        </div>
      )}

      {/* Buy button */}
      {maxed ? (
        <div className="text-xs text-emerald-400 font-medium text-center mt-0.5">
          {T.maxLevel}
        </div>
      ) : (
        <button
          onClick={onBuy}
          disabled={!canAfford}
          className={`mt-0.5 px-2.5 py-1.5 text-xs rounded border font-[inherit] flex items-center justify-center gap-1 ${
            canAfford
              ? "border-green-800 bg-green-950/50 text-green-300 cursor-pointer hover:bg-green-900/50"
              : "border-gray-700 bg-[#2a2a2a] text-gray-600 cursor-not-allowed"
          }`}
        >
          <span className="text-yellow-400">{T.btn_upgrade}</span>
          <span className="opacity-80">—</span>
          <span className="tabular-nums text-yellow-400">{cost}</span>
          <span className="opacity-65">{costCurrencyName}</span>
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
