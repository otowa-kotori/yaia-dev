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

/** Legacy geometric XP curve kept for older systems and simple scalings. */
export interface ExpCurveV1 {
  kind: "exp_curve_v1";
  /** XP required at level 1. */
  base: number;
  /** Geometric growth rate per level. */
  growth: number;
  /** Variable name holding the level. Defaults to "level". */
  levelVar?: string;
}

/** Shared parameters for the progression soft-curve family. */
export interface SoftXpCurveParams {
  a: number;
  p: number;
  c: number;
  base: number;
  cap: number;
  d: number;
  e: number;
  offset: number;
  /** Variable name holding the level. Defaults to "level". */
  levelVar?: string;
}

/** Character XP curve from docs/design/progression.md. */
export interface CharXpCurveV1 extends SoftXpCurveParams {
  kind: "char_xp_curve_v1";
}

/** Skill XP curve. Kept as a separate kind so it can diverge later. */
export interface SkillXpCurveV1 extends SoftXpCurveParams {
  kind: "skill_xp_curve_v1";
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
  | CharXpCurveV1
  | SkillXpCurveV1
  | LinearFormula
  | PowerFormula
  | ConstantFormula
  | AtkVsDefFormula;
