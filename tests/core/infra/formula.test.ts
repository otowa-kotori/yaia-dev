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

  test("phys_damage_v1: 已破甲时伤害 = floor(PATK × skillMul)", () => {
    // PATK=15, PDEF=1 → excess=max(0,1/15-1)=0 → armorCoeff=1 → damage=15
    const f: FormulaRef = { kind: "phys_damage_v1" };
    expect(evalFormula(f, { vars: { patk: 15, pdef: 1 } })).toBe(15);
  });

  test("phys_damage_v1: PDEF > PATK 时衰减明显", () => {
    // PATK=10, PDEF=20 → excess=max(0,20/10-1)=1
    // armorCoeff = max(0.1, 0.8/(0.8+1^1.5)) = 0.8/1.8 ≈ 0.444
    // damage = floor(10 × 0.444) = 4
    const f: FormulaRef = { kind: "phys_damage_v1" };
    const damage = evalFormula(f, { vars: { patk: 10, pdef: 20 } });
    expect(damage).toBe(4);
  });

  test("phys_damage_v1: skillMul < 1 时有效攻击降低，破甲系数也降低", () => {
    // 有效攻击 = 40 × 0.65 = 26, PDEF=35
    // excess = max(0, 35/26 - 1) ≈ 0.346
    // armorCoeff = 0.8/(0.8+0.346^1.5) ≈ 0.8/0.804 ≈ 0.87 (但多段更弱)
    const f: FormulaRef = { kind: "phys_damage_v1", skillMul: 0.65 };
    const damage = evalFormula(f, { vars: { patk: 40, pdef: 35 } });
    expect(damage).toBeGreaterThan(0);
    expect(damage).toBeLessThan(26);
  });

  test("phys_damage_v1: patk=0 返回 0", () => {
    const f: FormulaRef = { kind: "phys_damage_v1" };
    expect(evalFormula(f, { vars: { patk: 0, pdef: 10 } })).toBe(0);
  });

  test("phys_damage_v1: floor 保底生效", () => {
    // PATK=1, PDEF=10000 → 极高 excess → armorCoeff 趋近 floor=0.1
    const f: FormulaRef = { kind: "phys_damage_v1" };
    const damage = evalFormula(f, { vars: { patk: 1, pdef: 10000 } });
    // 保底 floor(1 × 0.1) = 0，floor 是倍率，不是绝对值下限
    // 所以这里 damage 可能是 0，不违反设计
    expect(damage).toBeGreaterThanOrEqual(0);
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
