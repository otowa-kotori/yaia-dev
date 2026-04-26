import { describe, test, expect } from "bun:test";
import { evalFormula, type FormulaRef } from "../../../src/core/infra/formula";

const progressionParams = {
  a: 8,
  p: 1.8,
  c: 8,
  base: 1.25,
  cap: 0.18,
  d: 0.22,
  e: 80,
  offset: 8,
};

describe("formula", () => {

  test("constant", () => {
    const f: FormulaRef = { kind: "constant", value: 42 };
    expect(evalFormula(f, { vars: {} })).toBe(42);
    expect(evalFormula(f, { vars: { anything: 999 } })).toBe(42);
  });

  test("linear", () => {
    const f: FormulaRef = { kind: "linear", slope: 2, intercept: 5, xVar: "x" };
    expect(evalFormula(f, { vars: { x: 0 } })).toBe(5);
    expect(evalFormula(f, { vars: { x: 10 } })).toBe(25);
  });

  test("linear treats missing var as 0", () => {
    const f: FormulaRef = { kind: "linear", slope: 3, intercept: 1, xVar: "x" };
    expect(evalFormula(f, { vars: {} })).toBe(1);
  });

  test("power", () => {
    const f: FormulaRef = {
      kind: "power",
      coefficient: 10,
      exponent: 2,
      xVar: "n",
    };
    expect(evalFormula(f, { vars: { n: 3 } })).toBe(90);
    expect(evalFormula(f, { vars: { n: 0 } })).toBe(0);
  });

  test("exp_curve_v1 at level 1 returns base", () => {
    const f: FormulaRef = { kind: "exp_curve_v1", base: 100, growth: 1.1 };
    expect(evalFormula(f, { vars: { level: 1 } })).toBe(100);
  });

  test("exp_curve_v1 scales geometrically", () => {
    const f: FormulaRef = { kind: "exp_curve_v1", base: 100, growth: 1.1 };
    // Level 5 => floor(100 * 1.1^4) = floor(146.41) = 146
    expect(evalFormula(f, { vars: { level: 5 } })).toBe(146);
  });

  test("exp_curve_v1 at level <= 0 returns 0", () => {
    const f: FormulaRef = { kind: "exp_curve_v1", base: 100, growth: 1.2 };
    expect(evalFormula(f, { vars: { level: 0 } })).toBe(0);
    expect(evalFormula(f, { vars: { level: -3 } })).toBe(0);
  });

  test("exp_curve_v1 respects custom levelVar", () => {
    const f: FormulaRef = {
      kind: "exp_curve_v1",
      base: 50,
      growth: 2,
      levelVar: "lvl",
    };
    expect(evalFormula(f, { vars: { lvl: 3 } })).toBe(200);
  });

  test("char_xp_curve_v1 follows progression doc values", () => {
    const f: FormulaRef = {
      kind: "char_xp_curve_v1",
      ...progressionParams,
    };
    expect(evalFormula(f, { vars: { level: 5 } })).toBe(183);
    expect(evalFormula(f, { vars: { level: 10 } })).toBe(1147);
  });

  test("skill_xp_curve_v1 currently mirrors the character curve", () => {
    const f: FormulaRef = {
      kind: "skill_xp_curve_v1",
      ...progressionParams,
    };
    expect(evalFormula(f, { vars: { level: 15 } })).toBe(4813);
    expect(evalFormula(f, { vars: { level: 20 } })).toBe(16415);
  });

  test("soft XP curves return 0 at level <= 0 and respect custom levelVar", () => {
    const f: FormulaRef = {
      kind: "char_xp_curve_v1",
      ...progressionParams,
      levelVar: "lvl",
    };
    expect(evalFormula(f, { vars: { lvl: 0 } })).toBe(0);
    expect(evalFormula(f, { vars: { lvl: 5 } })).toBe(183);
  });

  test("phys_damage_v1: PDEF<=0 时视为无甲", () => {
    const f: FormulaRef = { kind: "phys_damage_v1" };
    expect(evalFormula(f, { vars: { patk: 15, pdef: 0 } })).toBe(15);
  });

  test("phys_damage_v1: x=1 时命中阈值伤害", () => {
    // 默认 t=0.25, m=1 → x=1 时 y=t=0.25
    // PATK=10, PDEF=10 → damage = floor(10 × 0.25) = 2
    const f: FormulaRef = { kind: "phys_damage_v1" };
    expect(evalFormula(f, { vars: { patk: 10, pdef: 10 } })).toBe(2);
  });

  test("phys_damage_v1: 破甲前增长慢", () => {
    // x = 8 / 10 = 0.8, a = (1 - 0.25 × 1) / 0.25 = 3
    // y = 0.25 × 0.8^3 = 0.128
    // damage = floor(10 × 0.128) = 1
    const f: FormulaRef = { kind: "phys_damage_v1" };
    expect(evalFormula(f, { vars: { patk: 8, pdef: 10 } })).toBe(1);
  });

  test("phys_damage_v1: 破甲后逐步回归减法直觉", () => {
    // x = 12 / 10 = 1.2
    // y = (1.2 - 1) + 0.25 / (1 + 1 × 0.2) = 0.4083...
    // damage = floor(10 × 0.4083...) = 4
    const f: FormulaRef = { kind: "phys_damage_v1" };
    expect(evalFormula(f, { vars: { patk: 12, pdef: 10 } })).toBe(4);
  });

  test("phys_damage_v1: skillMul < 1 时有效攻击降低，伤害也明显降低", () => {
    const base: FormulaRef = { kind: "phys_damage_v1" };
    const multiHit: FormulaRef = { kind: "phys_damage_v1", skillMul: 0.65 };
    const normalDamage = evalFormula(base, { vars: { patk: 40, pdef: 35 } });
    const reducedDamage = evalFormula(multiHit, { vars: { patk: 40, pdef: 35 } });
    expect(normalDamage).toBe(12);
    expect(reducedDamage).toBe(3);
    expect(reducedDamage).toBeLessThan(normalDamage);
  });

  test("phys_damage_v1: patk=0 返回 0", () => {
    const f: FormulaRef = { kind: "phys_damage_v1" };
    expect(evalFormula(f, { vars: { patk: 0, pdef: 10 } })).toBe(0);
  });

  test("phys_damage_v1: 极高护甲允许打成 0", () => {
    const f: FormulaRef = { kind: "phys_damage_v1" };
    expect(evalFormula(f, { vars: { patk: 1, pdef: 100 } })).toBe(0);
  });

  test("phys_damage_v1: 自定义 t/m 会改变阈值和回归速度", () => {
    // t=0.2, m=1.5 时，a = (1 - 0.2 × 1.5) / 0.2 = 3.5
    // x = 15 / 10 = 1.5
    // y = 0.5 + 0.2 / (1 + 1.5 × 0.5) = 0.614285...
    // damage = floor(10 × 0.614285...) = 6
    const f: FormulaRef = { kind: "phys_damage_v1", t: 0.2, m: 1.5 };
    expect(evalFormula(f, { vars: { patk: 15, pdef: 10 } })).toBe(6);
  });

  test("phys_damage_v1: 非法参数直接抛错", () => {
    expect(() => {
      evalFormula({ kind: "phys_damage_v1", t: 1 }, { vars: { patk: 10, pdef: 10 } });
    }).toThrow();
    expect(() => {
      evalFormula({ kind: "phys_damage_v1", t: 0.25, m: 4 }, { vars: { patk: 10, pdef: 10 } });
    }).toThrow();
  });

  test("magic_damage_v1: 基础计算", () => {
    // MATK=20, MRES=0.2, skillMul=1 → floor(20 × 1 × 0.8) = 16
    const f: FormulaRef = { kind: "magic_damage_v1" };
    expect(evalFormula(f, { vars: { matk: 20, mres: 0.2 } })).toBe(16);
  });

  test("magic_damage_v1: skillMul 缩放", () => {
    // MATK=30, MRES=0, skillMul=1.5 → floor(30 × 1.5) = 45
    const f: FormulaRef = { kind: "magic_damage_v1", skillMul: 1.5 };
    expect(evalFormula(f, { vars: { matk: 30, mres: 0 } })).toBe(45);
  });
});
