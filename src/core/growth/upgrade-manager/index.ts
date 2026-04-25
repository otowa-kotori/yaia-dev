// UpgradeManager - handles purchase transaction logic for global upgrades.
//
// Responsibilities:
// - Validate upgrade availability and max level
// - Check currency balance and deduct funds
// - Update upgrade levels in WorldRecord
// - Rebuild character-derived attributes after purchase
//
// All operations are pure transactions on the provided GameState; no side effects
// beyond mutation. The caller owns persistence, event emission, and UI notification.

import { upgradeCost } from "../worldrecord";
import { isPlayer, rebuildCharacterDerived } from "../../entity/actor";
import type { GameState } from "../../infra/state/types";
import type { ContentDb, AttrDef } from "../../content/types";

export interface UpgradePurchaseContext {
  state: GameState;
  content: ContentDb;
  attrDefs: Readonly<Record<string, AttrDef>>;
}

export type UpgradePurchaseResult =
  | {
      success: true;
      level: number;
      cost: number;
      costCurrency: string;
    }
  | {
      success: false;
      reason: "unknown" | "already_maxed" | "insufficient_funds";
    };

/** Attempt to purchase the next level of an upgrade.
 *
 * Returns structured purchase details on success so outer command layers can
 * emit logs / analytics without re-deriving what just happened.
 */
export function purchaseUpgrade(
  upgradeId: string,
  ctx: UpgradePurchaseContext,
): UpgradePurchaseResult {
  const def = ctx.content.upgrades[upgradeId];
  if (!def) {
    return {
      success: false,
      reason: "unknown",
    };
  }

  const currentLevel = ctx.state.worldRecord.upgrades[upgradeId] ?? 0;
  if (currentLevel >= def.maxLevel) {
    return {
      success: false,
      reason: "already_maxed",
    };
  }

  const cost = upgradeCost(def, currentLevel);
  const balance = ctx.state.currencies[def.costCurrency] ?? 0;
  if (balance < cost) {
    return {
      success: false,
      reason: "insufficient_funds",
    };
  }

  // All checks passed; mutate state.
  ctx.state.currencies[def.costCurrency] = balance - cost;
  const nextLevel = currentLevel + 1;
  ctx.state.worldRecord.upgrades[upgradeId] = nextLevel;

  // Rebuild derived state for every PlayerCharacter so world modifiers take effect.
  for (const actor of ctx.state.actors) {
    if (isPlayer(actor)) {
      rebuildCharacterDerived(actor, ctx.attrDefs, ctx.state.worldRecord);
    }
  }

  return {
    success: true,
    level: nextLevel,
    cost,
    costCurrency: def.costCurrency,
  };
}

/** Query the next upgrade level's cost without mutation.
 *  Returns 0 if already at maxLevel. */
export function getUpgradeCost(
  upgradeId: string,
  ctx: UpgradePurchaseContext,
): number {
  const def = ctx.content.upgrades[upgradeId];
  if (!def) return 0;
  const currentLevel = ctx.state.worldRecord.upgrades[upgradeId] ?? 0;
  return upgradeCost(def, currentLevel);
}

/** Check if an upgrade is already at max level. */
export function isUpgradeMaxed(
  upgradeId: string,
  ctx: UpgradePurchaseContext,
): boolean {
  const def = ctx.content.upgrades[upgradeId];
  if (!def) return false;
  const currentLevel = ctx.state.worldRecord.upgrades[upgradeId] ?? 0;
  return currentLevel >= def.maxLevel;
}

/** Check if the player can afford the next level of an upgrade. */
export function canAffordUpgrade(
  upgradeId: string,
  ctx: UpgradePurchaseContext,
): boolean {
  const def = ctx.content.upgrades[upgradeId];
  if (!def) return false;
  const currentLevel = ctx.state.worldRecord.upgrades[upgradeId] ?? 0;
  if (currentLevel >= def.maxLevel) return false;
  const cost = upgradeCost(def, currentLevel);
  const balance = ctx.state.currencies[def.costCurrency] ?? 0;
  return balance >= cost;
}
