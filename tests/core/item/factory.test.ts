import { describe, test, expect, beforeEach } from "bun:test";
import { createRng } from "../../../src/core/infra/rng";
import {
  patchContent,
  resetContent,
} from "../../../src/core/content";
import type { ItemDef, ItemId } from "../../../src/core/content/types";
import { createGearInstance } from "../../../src/core/item";
import { ATTR } from "../../../src/core/entity/attribute";
import { loadFixtureContent } from "../../fixtures/content";

const rolledSword: ItemDef = {
  id: "item.weapon.test_rolled_sword" as ItemId,
  name: "Rolled Sword",
  stackable: false,
  slot: "weapon",
  modifiers: [{ stat: ATTR.PATK, op: "flat", value: 5, sourceId: "" }],
  roll: {
    mods: [
      { stat: ATTR.PATK, op: "flat", min: 1, max: 10 },
      { stat: ATTR.STR, op: "flat", min: 0, max: 3 },
    ],
  },
};

const plainHelmet: ItemDef = {
  id: "item.helm.plain_test" as ItemId,
  name: "Plain Helmet",
  stackable: false,
  slot: "head",
  modifiers: [{ stat: ATTR.PDEF, op: "flat", value: 2, sourceId: "" }],
  // no roll â€?rolledMods should come back empty.
};

const oreStackable: ItemDef = {
  id: "item.ore.test_stackable" as ItemId,
  name: "Stackable Ore",
  stackable: true,
};

describe("createGearInstance", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
    patchContent({
      items: {
        [rolledSword.id]: rolledSword,
        [plainHelmet.id]: plainHelmet,
        [oreStackable.id]: oreStackable,
      },
    });
  });

  test("rolls one Modifier per entry, clamped to [min, max]", () => {
    const rng = createRng(1);
    const gear = createGearInstance(rolledSword.id, { rng });
    expect(gear.itemId).toBe(rolledSword.id);
    expect(gear.rolledMods.length).toBe(2);
    const atk = gear.rolledMods.find((m) => m.stat === ATTR.PATK)!;
    const str = gear.rolledMods.find((m) => m.stat === ATTR.STR)!;
    expect(atk.value).toBeGreaterThanOrEqual(1);
    expect(atk.value).toBeLessThanOrEqual(10);
    expect(str.value).toBeGreaterThanOrEqual(0);
    expect(str.value).toBeLessThanOrEqual(3);
    // integer default
    expect(Number.isInteger(atk.value)).toBe(true);
    expect(Number.isInteger(str.value)).toBe(true);
  });

  test("same rng seed yields identical rolledMods + instanceId (deterministic)", () => {
    const a = createGearInstance(rolledSword.id, { rng: createRng(9001) });
    const b = createGearInstance(rolledSword.id, { rng: createRng(9001) });
    expect(a).toEqual(b);
  });

  test("items with no roll spec produce empty rolledMods", () => {
    const gear = createGearInstance(plainHelmet.id, { rng: createRng(1) });
    expect(gear.rolledMods).toEqual([]);
    expect(gear.instanceId).toMatch(/^gear\./);
  });

  test("refuses to instantiate a stackable item", () => {
    expect(() =>
      createGearInstance(oreStackable.id, { rng: createRng(1) }),
    ).toThrow(/stackable/);
  });

  test("throws loudly on missing content id", () => {
    expect(() =>
      createGearInstance("item.does.not.exist" as ItemId, { rng: createRng(1) }),
    ).toThrow(/no item/);
  });
});
