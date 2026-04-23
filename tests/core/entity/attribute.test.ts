import { describe, test, expect } from "bun:test";
import {
  addModifiers,
  ATTR,
  createAttrSet,
  getAttr,
  invalidateAttrs,
  recomputeAttrs,
  removeModifiersBySource,
} from "../../../src/core/entity/attribute";
import type { AttrDef, AttrId, Modifier } from "../../../src/core/content/types";

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

// ---------- Stacking formula ----------

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

// ---------- Per-stat dirty precision ----------

describe("per-stat cache precision", () => {
  test("addModifiers on stat A does not dirty stat B's cache entry", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100, [ATTR.ATK]: 10 });
    // Warm both stats.
    getAttr(s, ATTR.MAX_HP, defs);
    getAttr(s, ATTR.ATK, defs);
    const atkKeyBefore = ATTR.ATK in s.cache;

    // Add a modifier that only touches MAX_HP.
    addModifiers(s, [mod(ATTR.MAX_HP, "flat", 50)]);

    // MAX_HP must be evicted from cache.
    expect(ATTR.MAX_HP in s.cache).toBe(false);
    // ATK cache entry must still be present (not evicted).
    expect(ATTR.ATK in s.cache).toBe(atkKeyBefore); // true
    // ATK value must be unchanged without recompute.
    expect(s.cache[ATTR.ATK]).toBe(10);
  });

  test("removeModifiersBySource only evicts stats referenced by removed mods", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100, [ATTR.ATK]: 10 });
    addModifiers(s, [
      mod(ATTR.MAX_HP, "flat", 20, "gear"),
      mod(ATTR.ATK, "flat", 5, "other"),
    ]);
    // Warm both.
    getAttr(s, ATTR.MAX_HP, defs);
    getAttr(s, ATTR.ATK, defs);

    // Remove only the MAX_HP modifier.
    removeModifiersBySource(s, "gear");

    expect(ATTR.MAX_HP in s.cache).toBe(false);  // evicted
    expect(ATTR.ATK in s.cache).toBe(true);       // untouched
    expect(s.cache[ATTR.ATK]).toBe(15);           // still correct
  });

  test("modifier touching multiple stats only evicts those stats", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100, [ATTR.ATK]: 10 });
    addModifiers(s, [
      mod(ATTR.MAX_HP, "flat", 20, "src"),
      mod(ATTR.ATK, "flat", 5, "src"),
    ]);
    // Warm both, then remove.
    getAttr(s, ATTR.MAX_HP, defs);
    getAttr(s, ATTR.ATK, defs);
    // Also warm CRIT_RATE which no mod touches.
    getAttr(s, ATTR.CRIT_RATE, defs);

    removeModifiersBySource(s, "src");

    expect(ATTR.MAX_HP in s.cache).toBe(false);     // evicted
    expect(ATTR.ATK in s.cache).toBe(false);         // evicted
    expect(ATTR.CRIT_RATE in s.cache).toBe(true);    // untouched
  });

  test("getAttr recomputes only the dirty stat, not the whole set", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100, [ATTR.ATK]: 10 });
    // Warm ATK, leave MAX_HP dirty.
    getAttr(s, ATTR.ATK, defs);

    // Manually confirm MAX_HP is absent (dirty).
    expect(ATTR.MAX_HP in s.cache).toBe(false);

    // Reading MAX_HP computes it without disturbing ATK cache.
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(100);
    expect(ATTR.MAX_HP in s.cache).toBe(true);
    expect(s.cache[ATTR.ATK]).toBe(10); // still present
  });

  test("invalidateAttrs marks all stats dirty at once", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 100, [ATTR.ATK]: 10 });
    getAttr(s, ATTR.MAX_HP, defs);
    getAttr(s, ATTR.ATK, defs);
    expect(Object.keys(s.cache).length).toBe(2);

    invalidateAttrs(s);
    expect(Object.keys(s.cache).length).toBe(0);

    // Values still correct after recompute on demand.
    expect(getAttr(s, ATTR.MAX_HP, defs)).toBe(100);
    expect(getAttr(s, ATTR.ATK, defs)).toBe(10);
  });

  test("recomputeAttrs eagerly warms every known stat", () => {
    const s = createAttrSet({ [ATTR.MAX_HP]: 200 });
    addModifiers(s, [mod(ATTR.ATK, "flat", 3)]);
    // cache is empty (dirty), no reads yet.
    expect(Object.keys(s.cache).length).toBe(0);

    recomputeAttrs(s, defs);

    // All AttrDef keys should now be cached.
    for (const id of Object.keys(defs)) {
      expect(id in s.cache).toBe(true);
    }
    expect(s.cache[ATTR.MAX_HP]).toBe(200);
    expect(s.cache[ATTR.ATK]).toBe(13);
  });
});
