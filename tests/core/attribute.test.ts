import { describe, test, expect } from "bun:test";
import {
  addModifiers,
  ATTR,
  createAttrSet,
  getAttr,
  removeModifiersBySource,
} from "../../src/core/attribute";
import type { AttrDef, AttrId, Modifier } from "../../src/core/content/types";

const defs: Record<string, AttrDef> = {
  [ATTR.MAX_HP]: {
    id: ATTR.MAX_HP as AttrId,
    name: "Max HP",
    defaultBase: 100,
    integer: true,
    clampMin: 0,
  },
  [ATTR.ATK]: {
    id: ATTR.ATK as AttrId,
    name: "Atk",
    defaultBase: 10,
    integer: true,
    clampMin: 0,
  },
  [ATTR.CRIT_RATE]: {
    id: ATTR.CRIT_RATE as AttrId,
    name: "Crit Rate",
    defaultBase: 0,
    clampMin: 0,
    clampMax: 1,
  },
};

const mod = (
  stat: string,
  op: "flat" | "pct_add" | "pct_mult",
  value: number,
  sourceId = "test",
): Modifier => ({ stat: stat as AttrId, op, value, sourceId });

describe("attribute stacking", () => {
  test("missing AttrDef value falls back to defaultBase", () => {
    const s = createAttrSet();
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(100);
  });

  test("explicit base overrides defaultBase", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 250 });
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(250);
  });

  test("flat adds to base", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100 });
    addModifiers(s, [mod(ATTR.MAX_HP, "flat", 15)]);
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(115);
  });

  test("pct_add is additive among peers", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100 });
    // +10% and +20% pct_add => (100+0) * (1 + 0.3) = 130
    addModifiers(s, [
      mod(ATTR.MAX_HP, "pct_add", 0.1, "a"),
      mod(ATTR.MAX_HP, "pct_add", 0.2, "b"),
    ]);
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(130);
  });

  test("pct_mult compounds multiplicatively", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100 });
    addModifiers(s, [
      mod(ATTR.MAX_HP, "pct_mult", 0.1, "a"),
      mod(ATTR.MAX_HP, "pct_mult", 0.2, "b"),
    ]);
    // 100 * 1.1 * 1.2 = 132
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(132);
  });

  test("order: (base + flat) * (1 + pct_add) * Π(1 + pct_mult)", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100 });
    addModifiers(s, [
      mod(ATTR.MAX_HP, "flat", 20, "gear"),
      mod(ATTR.MAX_HP, "pct_add", 0.5, "buff1"),
      mod(ATTR.MAX_HP, "pct_mult", 0.2, "set"),
    ]);
    // (100 + 20) * 1.5 * 1.2 = 216
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(216);
  });

  test("clamp is applied after stacking", () => {
    const s = createAttrSet();
    addModifiers(s, [mod(ATTR.CRIT_RATE, "flat", 5)]);
    expect(getAttr(s, ATTR.CRIT_RATE, defs)).toBe(1); // clamped to clampMax=1
  });

  test("integer flag floors the final value", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100 });
    addModifiers(s, [mod(ATTR.MAX_HP, "pct_add", 0.333, "a")]);
    // 100 * 1.333 = 133.3 => floor = 133
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(133);
  });

  test("removeModifiersBySource only removes matching sourceId", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100 });
    addModifiers(s, [
      mod(ATTR.MAX_HP, "flat", 10, "equip:weapon"),
      mod(ATTR.MAX_HP, "flat", 5, "equip:ring"),
    ]);
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(115);
    const removed = removeModifiersBySource(s, "equip:weapon");
    expect(removed).toBe(1);
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(105);
  });

  test("cache invalidates on addModifiers / removeModifiersBySource", () => {
    const s = createAttrSet({ [ATTR.ATK]: 10 });
    expect(getAttr(s, ATTR.ATK, defs)).toBe(10);
    addModifiers(s, [mod(ATTR.ATK, "flat", 5)]);
    expect(getAttr(s, ATTR.ATK, defs)).toBe(15);
    removeModifiersBySource(s, "test");
    expect(getAttr(s, ATTR.ATK, defs)).toBe(10);
  });

  test("unknown attr returns 0 when no AttrDef exists", () => {
    const s = createAttrSet();
    expect(getAttr(s, "attr.unknown", defs)).toBe(0);
  });
});
