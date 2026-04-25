// Formula evaluator. One switch, one function. The registry / parser seams
// live behind this function signature — replace the body if needs outgrow
// named formulas.

import type {
  CharXpCurveV1,
  FormulaContext,
  FormulaRef,
  SkillXpCurveV1,
} from "./types";

export function evalFormula(ref: FormulaRef, ctx: FormulaContext): number {
  const vars = ctx.vars;
  switch (ref.kind) {
    case "constant":
      return ref.value;

    case "linear": {
      const x = varOrZero(vars, ref.xVar);
      return ref.slope * x + ref.intercept;
    }

    case "power": {
      const x = varOrZero(vars, ref.xVar);
      return ref.coefficient * Math.pow(x, ref.exponent);
    }

    case "exp_curve_v1": {
      const levelVar = ref.levelVar ?? "level";
      const level = varOrZero(vars, levelVar);
      // XP to reach level L = floor(base * growth^(L-1)) for L >= 1.
      // At L <= 0 we return 0 (cannot go below level 1).
      if (level <= 1) return level <= 0 ? 0 : ref.base;
      return Math.floor(ref.base * Math.pow(ref.growth, level - 1));
    }

    case "char_xp_curve_v1":
    case "skill_xp_curve_v1": {
      return evalSoftXpCurve(ref, vars);
    }

    case "phys_damage_v1": {
      // 两步计算：
      //   有效攻击 = PATK × skillMul
      //   excess   = max(0, PDEF / 有效攻击 − 1)
      //   破甲系数 = max(floor, K / (K + excess^p))
      //   最终伤害 = ⌊有效攻击 × 破甲系数⌋
      const patk     = varOrZero(vars, "patk");
      const pdef     = varOrZero(vars, "pdef");
      const skillMul = ref.skillMul ?? 1;
      const K        = ref.K ?? 0.8;
      const p        = ref.p ?? 1.5;
      const fl       = ref.floor ?? 0.1;
      const effectiveAtk = patk * skillMul;
      if (effectiveAtk <= 0) return 0;
      const excess = Math.max(0, pdef / effectiveAtk - 1);
      const armorCoeff = Math.max(fl, K / (K + Math.pow(excess, p)));
      return Math.floor(effectiveAtk * armorCoeff);
    }

    case "magic_damage_v1": {
      // 最终伤害 = ⌊MATK × skillMul × (1 − MRES)⌋
      const matk     = varOrZero(vars, "matk");
      const mres     = varOrZero(vars, "mres");
      const skillMul = ref.skillMul ?? 1;
      return Math.floor(matk * skillMul * (1 - mres));
    }
  }
}

function evalSoftXpCurve(
  ref: CharXpCurveV1 | SkillXpCurveV1,
  vars: Readonly<Record<string, number>>,
): number {
  const levelVar = ref.levelVar ?? "level";
  const level = varOrZero(vars, levelVar);
  if (level <= 0) return 0;

  const brake = Math.min(ref.cap, (ref.d * level) / (level + ref.e));
  const surface = ref.a + Math.pow(level, ref.p) + ref.c * level;
  const exponentBase = ref.base - brake;
  return Math.floor(surface * Math.pow(exponentBase, level) - ref.offset);
}

function varOrZero(vars: Readonly<Record<string, number>>, name: string): number {
  const v = vars[name];
  return typeof v === "number" ? v : 0;
}
