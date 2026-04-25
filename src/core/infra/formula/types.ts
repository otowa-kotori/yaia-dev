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
 * 物理伤害公式（ratio-power 破甲方案）。
 *
 * 两步计算：
 *   有效攻击 = PATK × skillMul
 *   excess   = max(0, PDEF / 有效攻击 − 1)
 *   破甲系数 = max(floor, K / (K + excess^p))
 *   最终伤害 = ⌊有效攻击 × 破甲系数⌋
 *
 * 设计说明见 docs/design/combat-formula.md §2。
 */
export interface PhysDamageV1Formula {
  kind: "phys_damage_v1";
  /** 技能（段）系数，default 1.0。每段独立代入破甲公式。 */
  skillMul?: number;
  /** ratio-power 宽松度，default 0.8。 */
  K?: number;
  /** ratio-power 急转指数，default 1.5。 */
  p?: number;
  /** 保底伤害倍率，default 0.1（即有效攻击的 10%）。 */
  floor?: number;
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
