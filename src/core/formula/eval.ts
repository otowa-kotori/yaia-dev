// Formula evaluator. One switch, one function. The registry / parser seams
// live behind this function signature — replace the body if needs outgrow
// named formulas.

import type { FormulaContext, FormulaRef } from "./types";

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

    case "atk_vs_def": {
      const atk = varOrZero(vars, "atk");
      const def = varOrZero(vars, "def");
      const raw = atk * ref.atkMul - def * ref.defMul;
      const floor = ref.minDamage ?? 1;
      return Math.max(floor, Math.floor(raw));
    }
  }
}

function varOrZero(vars: Readonly<Record<string, number>>, name: string): number {
  const v = vars[name];
  return typeof v === "number" ? v : 0;
}
