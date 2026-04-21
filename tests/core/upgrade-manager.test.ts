// Tests for the upgrade-manager module: purchaseUpgrade + query helpers.
//
// Uses emptyContentDb() as a minimal ContentDb and only populates the
// upgrades slot plus a currency balance — upgrade-manager touches nothing
// else, so the fixture stays tiny.

import { describe, test, expect, beforeEach } from "bun:test";
import {
  purchaseUpgrade,
  getUpgradeCost,
  isUpgradeMaxed,
  canAffordUpgrade,
  type UpgradePurchaseContext,
} from "../../src/core/upgrade-manager";
import { createEmptyState, type GameState } from "../../src/core/state";
import { emptyContentDb, type ContentDb } from "../../src/core/content";
import type {
  AttrDef,
  AttrId,
  UpgradeDef,
} from "../../src/core/content/types";
import { ATTR } from "../../src/core/attribute";

// ---------- Fixture ----------

const testUpgrade: UpgradeDef = {
  id: "upgrade.atk_boost",
  name: "ATK Boost",
  description: "Increases attack",
  maxLevel: 5,
  costCurrency: "currency.gold",
  // base=100, growth=1.5 → level 1 costs 100, level 2 costs 150, etc.
  costScaling: { kind: "exp_curve_v1", base: 100, growth: 1.5 },
  modifierPerLevel: [
    { stat: ATTR.ATK as AttrId, op: "flat", value: 5, sourceId: "ignored" },
  ],
};

// Minimal attrDefs — only what rebuildCharacterDerived touches in a
// player-less state. purchaseUpgrade walks state.actors; with no actors,
// rebuildCharacterDerived is never called, so an empty record is enough.
const attrDefs: Readonly<Record<string, AttrDef>> = {};

describe("UpgradeManager", () => {
  let state: GameState;
  let content: ContentDb;
  let ctx: UpgradePurchaseContext;

  beforeEach(() => {
    state = createEmptyState(42, 1);
    content = {
      ...emptyContentDb(),
      upgrades: { [testUpgrade.id]: testUpgrade },
    };
    ctx = { state, content, attrDefs };

    // Give the player some starting gold (1000 is enough for ~3 levels).
    state.currencies["currency.gold"] = 1000;
  });

  describe("purchaseUpgrade", () => {
    test("fails for unknown upgrade", () => {
      const result = purchaseUpgrade("upgrade.unknown", ctx);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("unknown");
    });

    test("succeeds and mutates state on valid purchase", () => {
      const result = purchaseUpgrade("upgrade.atk_boost", ctx);
      expect(result.success).toBe(true);
      expect(state.worldRecord.upgrades["upgrade.atk_boost"]).toBe(1);
      expect(state.currencies["currency.gold"]).toBeLessThan(1000);
    });

    test("fails when already at max level", () => {
      state.worldRecord.upgrades["upgrade.atk_boost"] = 5;
      const result = purchaseUpgrade("upgrade.atk_boost", ctx);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("already_maxed");
    });

    test("fails when insufficient funds", () => {
      state.currencies["currency.gold"] = 10;
      const result = purchaseUpgrade("upgrade.atk_boost", ctx);
      expect(result.success).toBe(false);
      expect(result.reason).toBe("insufficient_funds");
    });

    test("deducts correct currency amount", () => {
      const cost = getUpgradeCost("upgrade.atk_boost", ctx);
      const before = state.currencies["currency.gold"] ?? 0;
      purchaseUpgrade("upgrade.atk_boost", ctx);
      const after = state.currencies["currency.gold"] ?? 0;
      expect(before - after).toBe(cost);
    });

    test("increments level on successive purchases", () => {
      purchaseUpgrade("upgrade.atk_boost", ctx);
      expect(state.worldRecord.upgrades["upgrade.atk_boost"]).toBe(1);
      purchaseUpgrade("upgrade.atk_boost", ctx);
      expect(state.worldRecord.upgrades["upgrade.atk_boost"]).toBe(2);
    });
  });

  describe("getUpgradeCost", () => {
    test("returns 0 for unknown upgrade", () => {
      expect(getUpgradeCost("upgrade.unknown", ctx)).toBe(0);
    });

    test("returns 0 when already at max level", () => {
      state.worldRecord.upgrades["upgrade.atk_boost"] = 5;
      expect(getUpgradeCost("upgrade.atk_boost", ctx)).toBe(0);
    });

    test("returns cost for current level", () => {
      // level 1 cost: ceil(100 * 1.5^0) = 100
      expect(getUpgradeCost("upgrade.atk_boost", ctx)).toBe(100);
    });
  });

  describe("isUpgradeMaxed", () => {
    test("returns false when not purchased", () => {
      expect(isUpgradeMaxed("upgrade.atk_boost", ctx)).toBe(false);
    });

    test("returns false at mid-level", () => {
      state.worldRecord.upgrades["upgrade.atk_boost"] = 3;
      expect(isUpgradeMaxed("upgrade.atk_boost", ctx)).toBe(false);
    });

    test("returns true at max level", () => {
      state.worldRecord.upgrades["upgrade.atk_boost"] = 5;
      expect(isUpgradeMaxed("upgrade.atk_boost", ctx)).toBe(true);
    });

    test("returns false for unknown upgrade", () => {
      expect(isUpgradeMaxed("upgrade.unknown", ctx)).toBe(false);
    });
  });

  describe("canAffordUpgrade", () => {
    test("returns false for unknown upgrade", () => {
      expect(canAffordUpgrade("upgrade.unknown", ctx)).toBe(false);
    });

    test("returns true with sufficient funds", () => {
      state.currencies["currency.gold"] = 1000;
      expect(canAffordUpgrade("upgrade.atk_boost", ctx)).toBe(true);
    });

    test("returns false with insufficient funds", () => {
      state.currencies["currency.gold"] = 10;
      expect(canAffordUpgrade("upgrade.atk_boost", ctx)).toBe(false);
    });

    test("returns false when already maxed", () => {
      state.worldRecord.upgrades["upgrade.atk_boost"] = 5;
      expect(canAffordUpgrade("upgrade.atk_boost", ctx)).toBe(false);
    });
  });
});
