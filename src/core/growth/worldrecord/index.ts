// WorldRecord utilities.
//
// WorldRecord holds the player's permanent global upgrade state. These pure
// functions compute the derived modifier list (injected into every PC by
// rebuildCharacterDerived) and the cost to purchase the next upgrade level.
//
// No side effects here — callers (store.purchaseUpgrade) own mutation.

import { evalFormula } from "../../infra/formula/eval";
import type { Modifier } from "../../content/types";
import type { UpgradeDef, ContentDb } from "../../content/types";
import type { WorldRecord } from "../../infra/state/types";

/** Aggregate all purchased upgrades into a flat Modifier list for injection
 *  into a PlayerCharacter's AttrSet via rebuildCharacterDerived.
 *
 *  Level N = modifierPerLevel applied N times. Each copy gets sourceId
 *  "world.<upgradeId>" so removeModifiersBySource can target a specific
 *  upgrade if needed (e.g. refund). */
export function computeWorldModifiers(
  record: WorldRecord,
  content: ContentDb,
): Modifier[] {
  const result: Modifier[] = [];
  for (const [upgradeId, level] of Object.entries(record.upgrades)) {
    if (level <= 0) continue;
    const def = content.upgrades[upgradeId];
    if (!def) continue; // content was removed after save — skip silently
    const sourceId = `world.${upgradeId}`;
    for (let i = 0; i < level; i++) {
      for (const m of def.modifierPerLevel) {
        result.push({ ...m, sourceId });
      }
    }
  }
  return result;
}

/** Gold cost to purchase the NEXT level of an upgrade.
 *  nextLevel = currentLevel + 1.
 *
 *  Uses exp_curve_v1 semantics: cost = base * growth^(nextLevel - 1).
 *  Returns 0 if already at maxLevel (callers should gate on this). */
export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  const nextLevel = currentLevel + 1;
  if (nextLevel > def.maxLevel) return 0;
  return Math.max(1, Math.ceil(evalFormula(def.costScaling, { vars: { level: nextLevel } })));
}
