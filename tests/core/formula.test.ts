import { describe, test, expect } from "bun:test";
import { evalFormula, type FormulaRef } from "../../src/core/formula";

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

  test("atk_vs_def applies floor", () => {
    const f: FormulaRef = { kind: "atk_vs_def", atkMul: 1, defMul: 1 };
    expect(evalFormula(f, { vars: { atk: 1, def: 100 } })).toBe(1); // floor default = 1
  });

  test("atk_vs_def with custom min", () => {
    const f: FormulaRef = {
      kind: "atk_vs_def",
      atkMul: 1,
      defMul: 1,
      minDamage: 0,
    };
    expect(evalFormula(f, { vars: { atk: 1, def: 100 } })).toBe(0);
  });

  test("atk_vs_def floors fractional damage", () => {
    const f: FormulaRef = { kind: "atk_vs_def", atkMul: 0.5, defMul: 0.1 };
    // 0.5 * 10 - 0.1 * 3 = 4.7 => floor = 4
    expect(evalFormula(f, { vars: { atk: 10, def: 3 } })).toBe(4);
  });
});
