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
 * 物理伤害公式（return-to-line 方案）。
 *
 * 令 x = (PATK × skillMul) / PDEF, y = damage / PDEF：
 *   y = t × x^a                       , x <= 1
 *   y = (x - 1) + t / (1 + m(x - 1)) , x > 1
 *   a = (1 - t × m) / t
 *
 * 最终伤害 = ⌊PDEF × y⌋。当 PDEF <= 0 时，视为无甲，伤害 = ⌊PATK × skillMul⌋。
 *
 * 设计说明见 docs/design/combat-formula.md §2。
 */
export interface PhysDamageV1Formula {
  kind: "phys_damage_v1";
  /** 技能（段）系数，default 1.0。每段独立代入伤害公式。 */
  skillMul?: number;
  /** x=1 时的阈值伤害，default 0.25。 */
  t?: number;
  /** 破甲后回归 ATK-DEF 直觉的速度，default 1.0。 */
  m?: number;
}


/**
 * 魔法伤害公式。
 *
 *   最终伤害 = ⌊MATK × skillMul × (1 − MRES)⌋
 *
 * MRES 是百分比减伤（0.0–0.8），天然无零伤害。
 */
export interface MagicDamageV1Formula {
  kind: "magic_damage_v1";
  /** 技能系数，default 1.0。 */
  skillMul?: number;
}

export type FormulaRef =
  | ExpCurveV1
  | CharXpCurveV1
  | SkillXpCurveV1
  | LinearFormula
  | PowerFormula
  | ConstantFormula
  | PhysDamageV1Formula
  | MagicDamageV1Formula;
