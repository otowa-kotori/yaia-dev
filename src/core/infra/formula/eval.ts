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
      // return-to-line 方案：
      //   有效攻击 = PATK × skillMul
      //   x = 有效攻击 / PDEF
      //   y = t × x^a                      , x <= 1
      //   y = (x - 1) + t / (1 + m(x - 1)), x > 1
      //   a = (1 - t × m) / t
      //   最终伤害 = ⌊PDEF × y⌋
      const patk = varOrZero(vars, "patk");
      const pdef = varOrZero(vars, "pdef");
      const skillMul = ref.skillMul ?? 1;
      const t = ref.t ?? 0.25;
      const m = ref.m ?? 1.0;
      const effectiveAtk = patk * skillMul;
      if (effectiveAtk <= 0) return 0;
      if (pdef <= 0) return Math.floor(effectiveAtk);
      if (!(t > 0 && t < 1)) {
        throw new Error(`phys_damage_v1: t must be in (0, 1), got ${t}`);
      }
      if (!(m > 0 && m < 1 / t)) {
        throw new Error(`phys_damage_v1: m must be in (0, ${1 / t}), got ${m}`);
      }
      const x = effectiveAtk / pdef;
      const a = (1 - t * m) / t;
      const y = x <= 1 ? t * Math.pow(x, a) : (x - 1) + t / (1 + m * (x - 1));
      return Math.floor(pdef * y);
    }


    case "magic_damage_v1": {
      // 最终伤害 = ⌊MATK × skillMul × (1 − MRES)⌋
      const matk     = varOrZero(vars, "matk");
      const mres     = varOrZero(vars, "mres");
      const skillMul = ref.skillMul ?? 1;
      return Math.floor(matk * skillMul * (1 - mres));
    }

    case "hit_rate_v1": {
      // hitRate = HIT / (HIT + EVA × k_hit), clamp [min, max]
      const hit  = varOrZero(vars, "hit");
      const eva  = varOrZero(vars, "eva");
      const kHit = ref.k_hit ?? (1 / 3);
      const min  = ref.clampMin ?? 0.3;
      const max  = ref.clampMax ?? 0.95;
      if (hit <= 0) return min;
      const raw = hit / (hit + eva * kHit);
      return Math.max(min, Math.min(max, raw));
    }

    case "crit_rate_v1": {
      // critChance = CRIT_RATE / (CRIT_RATE + CRIT_RES × k_crit), clamp [min, max]
      const critRate = varOrZero(vars, "crit_rate");
      const critRes  = varOrZero(vars, "crit_res");
      const kCrit = ref.k_crit ?? 4;
      const min   = ref.clampMin ?? 0;
      const max   = ref.clampMax ?? 0.75;
      if (critRate <= 0) return min;
      const raw = critRate / (critRate + critRes * kCrit);
      return Math.max(min, Math.min(max, raw));
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
