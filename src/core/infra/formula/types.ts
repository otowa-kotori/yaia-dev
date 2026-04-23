// Formula references. Plain-data, JSON-serializable.
//
// Evaluation happens in evalFormula() via a switch on `kind`. Adding a new
// formula kind = adding a case + a type entry here. No registry or runtime
// parser at MVP; the `FormulaRef` discriminated union is the contract.

/** Everything a formula can read. Keep minimal — grow only when needed. */
export interface FormulaContext {
  /** Generic variables exposed to formulas (level, atk, def, magnitudeBase, …). */
  vars: Readonly<Record<string, number>>;
}

/** XP required to reach `level` in a skill or character. */
export interface ExpCurveV1 {
  kind: "exp_curve_v1";
  /** XP required at level 1. */
  base: number;
  /** Geometric growth rate per level. */
  growth: number;
  /** Variable name holding the level. Defaults to "level". */
  levelVar?: string;
}

export interface LinearFormula {
  kind: "linear";
  /** y = slope * x + intercept, where x = vars[xVar]. */
  slope: number;
  intercept: number;
  xVar: string;
}

export interface PowerFormula {
  kind: "power";
  /** y = coefficient * (vars[xVar] ** exponent). */
  coefficient: number;
  exponent: number;
  xVar: string;
}

export interface ConstantFormula {
  kind: "constant";
  value: number;
}

/**
 * Attack vs defense damage baseline. MVP formula:
 *   damage = max(1, floor(atk * atkMul - def * defMul))
 * with atk = vars["atk"], def = vars["def"].
 * Configurable coefficients so numerical balance is data-driven.
 */
export interface AtkVsDefFormula {
  kind: "atk_vs_def";
  atkMul: number;
  defMul: number;
  /** Minimum damage floor (default 1). */
  minDamage?: number;
}

export type FormulaRef =
  | ExpCurveV1
  | LinearFormula
  | PowerFormula
  | ConstantFormula
  | AtkVsDefFormula;
