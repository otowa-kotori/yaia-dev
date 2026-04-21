// Tests for the worldrecord module: computeWorldModifiers, upgradeCost,
// and integration with rebuildCharacterDerived and applyRewards.

import { describe, test, expect, beforeEach } from "bun:test";
import { computeWorldModifiers, upgradeCost } from "../../src/core/worldrecord";
import {
  rebuildCharacterDerived,
  getAttr,
} from "../../src/core/actor";
import { applyEffect } from "../../src/core/effect";
import { ATTR } from "../../src/core/attribute";
import { setContent } from "../../src/core/content";
import type { UpgradeDef } from "../../src/core/content/types";
import type { WorldRecord } from "../../src/core/state/types";
import {
  attrDefs,
  loadFixtureContent,
  makeHarness,
  makePlayer,
} from "../fixtures/content";

// ---------- Fixture upgrade defs ----------

const atkUpgradeDef: UpgradeDef = {
  id: "upgrade.test.atk",
  name: "Test ATK",
  description: "test",
  maxLevel: 5,
  modifierPerLevel: [
    { stat: ATTR.ATK, op: "flat", value: 3, sourceId: "ignored" },
  ],
  costCurrency: "currency.gold",
  costScaling: { kind: "exp_curve_v1", base: 100, growth: 2.0 },
};

const multiStatUpgradeDef: UpgradeDef = {
  id: "upgrade.test.multi",
  name: "Test Multi",
  description: "test",
  maxLevel: 3,
  modifierPerLevel: [
    { stat: ATTR.ATK, op: "flat", value: 2, sourceId: "ignored" },
    { stat: ATTR.DEF, op: "flat", value: 1, sourceId: "ignored" },
  ],
  costCurrency: "currency.gold",
  costScaling: { kind: "exp_curve_v1", base: 50, growth: 1.5 },
};

// Minimal ContentDb with upgrades populated.
function makeContentWithUpgrades() {
  const content = loadFixtureContent();
  return {
    ...content,
    upgrades: {
      [atkUpgradeDef.id]: atkUpgradeDef,
      [multiStatUpgradeDef.id]: multiStatUpgradeDef,
    },
  };
}

// ---------- computeWorldModifiers ----------

describe("computeWorldModifiers", () => {
  test("returns empty array when no upgrades purchased", () => {
    const record: WorldRecord = { upgrades: {} };
    const content = makeContentWithUpgrades();
    expect(computeWorldModifiers(record, content)).toEqual([]);
  });

  test("level 1: returns one copy of modifierPerLevel", () => {
    const record: WorldRecord = { upgrades: { [atkUpgradeDef.id]: 1 } };
    const content = makeContentWithUpgrades();
    const mods = computeWorldModifiers(record, content);
    expect(mods).toHaveLength(1);
    expect(mods[0]!.stat).toBe(ATTR.ATK);
    expect(mods[0]!.value).toBe(3);
    expect(mods[0]!.sourceId).toBe(`world.${atkUpgradeDef.id}`);
  });

  test("level N stacks N copies", () => {
    const record: WorldRecord = { upgrades: { [atkUpgradeDef.id]: 3 } };
    const content = makeContentWithUpgrades();
    const mods = computeWorldModifiers(record, content);
    expect(mods).toHaveLength(3);
    const total = mods.reduce((s, m) => s + m.value, 0);
    expect(total).toBe(9); // 3×3
  });

  test("multi-stat upgrade produces N × perLevel entries", () => {
    const record: WorldRecord = { upgrades: { [multiStatUpgradeDef.id]: 2 } };
    const content = makeContentWithUpgrades();
    const mods = computeWorldModifiers(record, content);
    // 2 stats × 2 levels = 4 entries
    expect(mods).toHaveLength(4);
  });

  test("skips upgrade not in content (removed content)", () => {
    const record: WorldRecord = { upgrades: { "upgrade.missing": 5 } };
    const content = makeContentWithUpgrades();
    expect(computeWorldModifiers(record, content)).toEqual([]);
  });

  test("all modifiers carry the correct sourceId prefix", () => {
    const record: WorldRecord = { upgrades: { [atkUpgradeDef.id]: 2 } };
    const content = makeContentWithUpgrades();
    const mods = computeWorldModifiers(record, content);
    for (const m of mods) {
      expect(m.sourceId).toBe(`world.${atkUpgradeDef.id}`);
    }
  });
});

// ---------- upgradeCost ----------

describe("upgradeCost", () => {
  test("level 0→1 costs base", () => {
    // exp_curve_v1: cost(nextLevel) = base * growth^(nextLevel-1)
    // nextLevel = 1, growth^0 = 1 → cost = 100
    expect(upgradeCost(atkUpgradeDef, 0)).toBe(100);
  });

  test("level 1→2 costs base * growth", () => {
    // nextLevel = 2, growth^1 = 2 → cost = 200
    expect(upgradeCost(atkUpgradeDef, 1)).toBe(200);
  });

  test("level 2→3 compounds", () => {
    // nextLevel = 3, growth^2 = 4 → cost = 400
    expect(upgradeCost(atkUpgradeDef, 2)).toBe(400);
  });

  test("returns 0 when already at maxLevel", () => {
    expect(upgradeCost(atkUpgradeDef, atkUpgradeDef.maxLevel)).toBe(0);
  });

  test("always returns at least 1 for valid levels", () => {
    expect(upgradeCost(multiStatUpgradeDef, 0)).toBeGreaterThanOrEqual(1);
  });
});

// ---------- rebuildCharacterDerived with worldRecord ----------

describe("rebuildCharacterDerived + worldRecord", () => {
  beforeEach(() => {
    // Register test upgrades into the global content registry so
    // computeWorldModifiers (called inside rebuildCharacterDerived via
    // getContent()) can resolve them.
    const content = makeContentWithUpgrades();
    setContent(content);
  });

  test("injects world ATK modifiers for player", () => {
    const pc = makePlayer({ id: "p1", abilities: [], atk: 10 });
    const record: WorldRecord = { upgrades: { [atkUpgradeDef.id]: 2 } };

    rebuildCharacterDerived(pc, attrDefs, record);

    // base ATK 10 + 3×2 = 16
    expect(getAttr(pc, ATTR.ATK, attrDefs)).toBe(16);
  });

  test("no world modifiers when worldRecord omitted (enemy path)", () => {
    const pc = makePlayer({ id: "p1", abilities: [], atk: 10 });
    rebuildCharacterDerived(pc, attrDefs); // no worldRecord

    expect(getAttr(pc, ATTR.ATK, attrDefs)).toBe(10);
  });

  test("rebuild is idempotent — double call gives same result", () => {
    const record: WorldRecord = { upgrades: { [atkUpgradeDef.id]: 1 } };
    const pc = makePlayer({ id: "p1", abilities: [], atk: 10 });

    rebuildCharacterDerived(pc, attrDefs, record);
    const first = getAttr(pc, ATTR.ATK, attrDefs);
    rebuildCharacterDerived(pc, attrDefs, record);
    const second = getAttr(pc, ATTR.ATK, attrDefs);

    expect(first).toBe(second);
    expect(first).toBe(13); // 10 + 3
  });
});

// ---------- applyRewards writes currencies ----------

describe("applyRewards: currencies", () => {
  test("currencies are written to state.currencies", () => {
    const h = makeHarness();
    const pc = makePlayer({ id: "hero.1", abilities: [] });
    h.state.actors.push(pc);
    h.state.inventories[pc.id] = { capacity: 20, slots: Array(20).fill(null) };

    const rewardEffect = {
      id: "effect.runtime.test_reward" as never,
      kind: "instant" as const,
      rewards: { currencies: { "currency.gold": 15 } },
    };

    // Use the enemy as source (irrelevant for reward-only effects)
    applyEffect(rewardEffect, pc, pc, {
      state: h.state,
      bus: h.bus,
      rng: h.rng,
      attrDefs: h.attrDefs,
      currentTick: 0,
    });

    expect(h.state.currencies["currency.gold"]).toBe(15);
  });

  test("multiple reward calls accumulate", () => {
    const h = makeHarness();
    const pc = makePlayer({ id: "hero.1", abilities: [] });
    h.state.actors.push(pc);
    h.state.inventories[pc.id] = { capacity: 20, slots: Array(20).fill(null) };

    const rewardEffect = {
      id: "effect.runtime.test_reward2" as never,
      kind: "instant" as const,
      rewards: { currencies: { "currency.gold": 5 } },
    };

    applyEffect(rewardEffect, pc, pc, { state: h.state, bus: h.bus, rng: h.rng, attrDefs: h.attrDefs, currentTick: 0 });
    applyEffect(rewardEffect, pc, pc, { state: h.state, bus: h.bus, rng: h.rng, attrDefs: h.attrDefs, currentTick: 1 });
    applyEffect(rewardEffect, pc, pc, { state: h.state, bus: h.bus, rng: h.rng, attrDefs: h.attrDefs, currentTick: 2 });

    expect(h.state.currencies["currency.gold"]).toBe(15);
  });
});
