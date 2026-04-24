import { describe, test, expect } from "bun:test";
import {
  addModifiers,
  addDynamicProvider,
  ATTR,
  createAttrSet,
  getAttr,
  invalidateAttrs,
  recomputeAttrs,
  rebuildDepGraph,
  removeDynamicProvider,
  removeModifiersBySource,
} from "../../../src/core/entity/attribute";
import type { AttrDef, AttrId, DynamicModifierProvider, Modifier } from "../../../src/core/content/types";

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

// ---------- Derived base (computeBase) ----------

describe("derived base (computeBase)", () => {
  const STR = "attr.str" as AttrId;
  const WEAPON_ATK = "attr.weapon_atk" as AttrId;
  const PATK = "attr.patk" as AttrId;

  const derivedDefs: Record<string, AttrDef> = {
    [STR]: { id: STR, name: "力量", defaultBase: 20, integer: true },
    [WEAPON_ATK]: { id: WEAPON_ATK, name: "武器攻击", defaultBase: 50, integer: true },
    [PATK]: {
      id: PATK,
      name: "物理攻击",
      defaultBase: 0,
      integer: true,
      computeBase: (get) => {
        const w = get(WEAPON_ATK);
        const s = get(STR);
        return w * (1 + 0.3 * Math.sqrt(s));
      },
      dependsOn: [WEAPON_ATK, STR],
    },
  };

  test("computeBase 覆盖静态 base", () => {
    const s = createAttrSet({ [STR]: 25, [WEAPON_ATK]: 100 });
    rebuildDepGraph(s, derivedDefs);
    // 100 * (1 + 0.3 * sqrt(25)) = 100 * (1 + 1.5) = 250
    expect(getAttr(s, PATK, derivedDefs)).toBe(250);
  });

  test("依赖属性变化触发 PATK 重算", () => {
    const s = createAttrSet({ [STR]: 25, [WEAPON_ATK]: 100 });
    rebuildDepGraph(s, derivedDefs);
    // 预热 PATK cache
    expect(getAttr(s, PATK, derivedDefs)).toBe(250);
    // STR 加 11 → STR = 36
    addModifiers(s, [mod(STR, "flat", 11)]);
    // 100 * (1 + 0.3 * sqrt(36)) = 100 * (1 + 1.8) = 280
    expect(getAttr(s, PATK, derivedDefs)).toBe(280);
  });

  test("多级依赖链传播：A 依赖 B 依赖 C，改 C 三者都更新", () => {
    const A = "attr.a" as AttrId;
    const B = "attr.b" as AttrId;
    const C = "attr.c" as AttrId;
    const chainDefs: Record<string, AttrDef> = {
      [C]: { id: C, name: "C", defaultBase: 10, integer: true },
      [B]: {
        id: B, name: "B", defaultBase: 0, integer: true,
        computeBase: (get) => get(C) * 2,
        dependsOn: [C],
      },
      [A]: {
        id: A, name: "A", defaultBase: 0, integer: true,
        computeBase: (get) => get(B) + 5,
        dependsOn: [B],
      },
    };
    const s = createAttrSet({ [C]: 10 });
    rebuildDepGraph(s, chainDefs);
    // B = 20, A = 25
    expect(getAttr(s, A, chainDefs)).toBe(25);
    // C +5 → C=15, B=30, A=35
    addModifiers(s, [mod(C, "flat", 5)]);
    expect(getAttr(s, A, chainDefs)).toBe(35);
  });

  test("循环依赖 throw", () => {
    const X = "attr.x" as AttrId;
    const Y = "attr.y" as AttrId;
    const circDefs: Record<string, AttrDef> = {
      [X]: {
        id: X, name: "X", defaultBase: 0,
        computeBase: (get) => get(Y),
        dependsOn: [Y],
      },
      [Y]: {
        id: Y, name: "Y", defaultBase: 0,
        computeBase: (get) => get(X),
        dependsOn: [X],
      },
    };
    const s = createAttrSet();
    rebuildDepGraph(s, circDefs);
    expect(() => getAttr(s, X, circDefs)).toThrow("Circular attr dependency");
  });

  test("static modifier 叠加到派生 base 上", () => {
    const s = createAttrSet({ [STR]: 25, [WEAPON_ATK]: 100 });
    rebuildDepGraph(s, derivedDefs);
    // base 来自 computeBase = 250，再加 flat +50
    addModifiers(s, [mod(PATK, "flat", 50)]);
    expect(getAttr(s, PATK, derivedDefs)).toBe(300);
  });
});

// ---------- Dynamic modifier providers ----------

describe("dynamic modifier providers", () => {
  test("addDynamicProvider 影响 getAttr", () => {
    const s = createAttrSet({ [ATTR.ATK]: 10 });
    addDynamicProvider(s, {
      sourceId: "test-provider",
      targetAttrs: [ATTR.ATK],
      dependsOn: [],
      compute: () => [{ stat: ATTR.ATK, op: "flat" as const, value: 10, sourceId: "test-provider" }],
    }, defs);
    expect(getAttr(s, ATTR.ATK, defs)).toBe(20);
  });

  test("removeDynamicProvider 还原原值", () => {
    const s = createAttrSet({ [ATTR.ATK]: 10 });
    addDynamicProvider(s, {
      sourceId: "test-provider",
      targetAttrs: [ATTR.ATK],
      dependsOn: [],
      compute: () => [{ stat: ATTR.ATK, op: "flat" as const, value: 10, sourceId: "test-provider" }],
    }, defs);
    expect(getAttr(s, ATTR.ATK, defs)).toBe(20);
    removeDynamicProvider(s, "test-provider", defs);
    expect(getAttr(s, ATTR.ATK, defs)).toBe(10);
  });

  test("provider 依赖的属性变化 → 目标属性更新", () => {
    const INT = ATTR.INT;
    const HEAL = "attr.heal_power" as AttrId;
    const healDefs: Record<string, AttrDef> = {
      ...defs,
      [INT]: { id: INT, name: "智力", defaultBase: 100, integer: true },
      [HEAL]: { id: HEAL, name: "治疗强度", defaultBase: 0, integer: true },
    };
    const s = createAttrSet({ [INT]: 100 });
    addDynamicProvider(s, {
      sourceId: "talent:heal",
      targetAttrs: [HEAL],
      dependsOn: [INT],
      compute: (get) => [{
        stat: HEAL, op: "flat" as const,
        value: Math.floor(get(INT) * 0.1),
        sourceId: "talent:heal",
      }],
    }, healDefs);
    // INT=100 → HEAL = floor(100*0.1) = 10
    expect(getAttr(s, HEAL, healDefs)).toBe(10);
    // 加 +INT buff → INT=150 → HEAL = floor(150*0.1) = 15
    addModifiers(s, [mod(INT, "flat", 50, "buff")]);
    expect(getAttr(s, HEAL, healDefs)).toBe(15);
  });

  test("multiple providers 叠加同一属性", () => {
    const s = createAttrSet({ [ATTR.ATK]: 10 });
    addDynamicProvider(s, {
      sourceId: "provider-a",
      targetAttrs: [ATTR.ATK],
      dependsOn: [],
      compute: () => [{ stat: ATTR.ATK, op: "flat" as const, value: 5, sourceId: "provider-a" }],
    }, defs);
    addDynamicProvider(s, {
      sourceId: "provider-b",
      targetAttrs: [ATTR.ATK],
      dependsOn: [],
      compute: () => [{ stat: ATTR.ATK, op: "flat" as const, value: 3, sourceId: "provider-b" }],
    }, defs);
    expect(getAttr(s, ATTR.ATK, defs)).toBe(18); // 10 + 5 + 3
  });

  test("provider 升级：remove 旧 + add 新，值正确切换", () => {
    const s = createAttrSet({ [ATTR.ATK]: 10 });
    addDynamicProvider(s, {
      sourceId: "talent:lv1",
      targetAttrs: [ATTR.ATK],
      dependsOn: [],
      compute: () => [{ stat: ATTR.ATK, op: "flat" as const, value: 5, sourceId: "talent:lv1" }],
    }, defs);
    expect(getAttr(s, ATTR.ATK, defs)).toBe(15);

    removeDynamicProvider(s, "talent:lv1", defs);
    addDynamicProvider(s, {
      sourceId: "talent:lv2",
      targetAttrs: [ATTR.ATK],
      dependsOn: [],
      compute: () => [{ stat: ATTR.ATK, op: "flat" as const, value: 10, sourceId: "talent:lv2" }],
    }, defs);
    expect(getAttr(s, ATTR.ATK, defs)).toBe(20);
  });
});

// ---------- Invalidation propagation ----------

describe("invalidation propagation", () => {
  const STR = "attr.str" as AttrId;
  const PATK = "attr.patk" as AttrId;
  const propDefs: Record<string, AttrDef> = {
    ...defs,
    [STR]: { id: STR, name: "力量", defaultBase: 20, integer: true },
    [PATK]: {
      id: PATK, name: "物理攻击", defaultBase: 0, integer: true,
      computeBase: (get) => get(STR) * 2,
      dependsOn: [STR],
    },
  };

  test("addModifiers 在依赖链上传播 invalidation", () => {
    const s = createAttrSet({ [STR]: 20 });
    rebuildDepGraph(s, propDefs);
    getAttr(s, PATK, propDefs); // 预热 PATK cache
    expect(PATK in s.cache).toBe(true);

    addModifiers(s, [mod(STR, "flat", 5)]);
    // STR 被 invalidate，PATK 也应被传播 invalidate
    expect(STR in s.cache).toBe(false);
    expect(PATK in s.cache).toBe(false);
  });

  test("removeModifiersBySource 也传播 invalidation", () => {
    const s = createAttrSet({ [STR]: 20 });
    rebuildDepGraph(s, propDefs);
    addModifiers(s, [mod(STR, "flat", 5, "gear")]);
    getAttr(s, PATK, propDefs); // 预热
    expect(PATK in s.cache).toBe(true);

    removeModifiersBySource(s, "gear");
    expect(PATK in s.cache).toBe(false);
  });

  test("不相关属性的 cache 不受影响", () => {
    const s = createAttrSet({ [STR]: 20, [ATTR.MAX_HP]: 100 });
    rebuildDepGraph(s, propDefs);
    getAttr(s, ATTR.MAX_HP, propDefs);
    getAttr(s, PATK, propDefs);

    addModifiers(s, [mod(STR, "flat", 5)]);
    // PATK 被 invalidate，MAX_HP 不受影响
    expect(PATK in s.cache).toBe(false);
    expect(ATTR.MAX_HP in s.cache).toBe(true);
  });

  test("已经 dirty 的 stat 不会重复传播（幂等性）", () => {
    const s = createAttrSet({ [STR]: 20 });
    rebuildDepGraph(s, propDefs);
    getAttr(s, PATK, propDefs); // 预热

    // 加两条都影响 STR 的 modifier
    addModifiers(s, [
      mod(STR, "flat", 5, "a"),
      mod(STR, "flat", 3, "b"),
    ]);
    // PATK 应只被 invalidate 一次（不报错，结果正确）
    expect(PATK in s.cache).toBe(false);
    // getAttr 正确计算最终值: STR = 20+5+3 = 28, PATK = 28*2 = 56
    expect(getAttr(s, PATK, propDefs)).toBe(56);
  });
});

// ---------- depGraph management ----------

describe("depGraph management", () => {
  test("rebuildDepGraph 从 AttrDef.dependsOn 构建正确的边", () => {
    const A = "attr.a" as AttrId;
    const B = "attr.b" as AttrId;
    const testDefs: Record<string, AttrDef> = {
      [A]: { id: A, name: "A", defaultBase: 0 },
      [B]: { id: B, name: "B", defaultBase: 0, computeBase: (get) => get(A), dependsOn: [A] },
    };
    const s = createAttrSet();
    rebuildDepGraph(s, testDefs);
    // A → B 这条边应在图中
    expect(s.depGraph[A]?.has(B)).toBe(true);
  });

  test("addDynamicProvider 增量更新 depGraph", () => {
    const s = createAttrSet();
    rebuildDepGraph(s, defs);
    const INT = ATTR.INT;
    addDynamicProvider(s, {
      sourceId: "test",
      targetAttrs: [ATTR.ATK],
      dependsOn: [INT],
      compute: (get) => [{ stat: ATTR.ATK, op: "flat" as const, value: get(INT), sourceId: "test" }],
    }, defs);
    // INT → ATK 这条边应在图中
    expect(s.depGraph[INT]?.has(ATTR.ATK)).toBe(true);
  });

  test("removeDynamicProvider 重建后边消失", () => {
    const s = createAttrSet();
    rebuildDepGraph(s, defs);
    const INT = ATTR.INT;
    addDynamicProvider(s, {
      sourceId: "test",
      targetAttrs: [ATTR.ATK],
      dependsOn: [INT],
      compute: (get) => [{ stat: ATTR.ATK, op: "flat" as const, value: get(INT), sourceId: "test" }],
    }, defs);
    expect(s.depGraph[INT]?.has(ATTR.ATK)).toBe(true);

    removeDynamicProvider(s, "test", defs);
    // 边应消失（defs 中没有 INT→ATK 的 AttrDef.dependsOn）
    expect(s.depGraph[INT]?.has(ATTR.ATK) ?? false).toBe(false);
  });

  test("rebuildDepGraph 覆盖旧图（幂等重建）", () => {
    const A = "attr.a" as AttrId;
    const B = "attr.b" as AttrId;
    const testDefs: Record<string, AttrDef> = {
      [A]: { id: A, name: "A", defaultBase: 0 },
      [B]: { id: B, name: "B", defaultBase: 0, computeBase: (get) => get(A), dependsOn: [A] },
    };
    const s = createAttrSet();
    // 手动污染 depGraph
    s.depGraph["stale"] = new Set(["garbage"]);
    rebuildDepGraph(s, testDefs);
    // 旧 stale 边应被清除
    expect("stale" in s.depGraph).toBe(false);
    expect(s.depGraph[A]?.has(B)).toBe(true);
  });
});

// ---------- recomputeAttrs with dynamic features ----------

describe("recomputeAttrs 覆盖 dynamic provider 目标属性", () => {
  test("recomputeAttrs 预热 dynamic provider 的目标属性", () => {
    const HEAL = "attr.heal_power" as AttrId;
    const healDefs: Record<string, AttrDef> = {
      ...defs,
      [HEAL]: { id: HEAL, name: "治疗强度", defaultBase: 0 },
    };
    const s = createAttrSet();
    addDynamicProvider(s, {
      sourceId: "test",
      targetAttrs: [HEAL],
      dependsOn: [],
      compute: () => [{ stat: HEAL, op: "flat" as const, value: 42, sourceId: "test" }],
    }, healDefs);
    recomputeAttrs(s, healDefs);
    // HEAL 应被预热进 cache
    expect(HEAL in s.cache).toBe(true);
    expect(s.cache[HEAL]).toBe(42);
  });
});
