import type { FormulaRef } from "../../core/infra/formula";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";

const defaultProgressionXpParams = {
  a: 8,
  p: 1.8,
  c: 8,
  base: 1.25,
  cap: 0.18,
  d: 0.22,
  e: 80,
  offset: 8,
};

/** Character XP curve from docs/design/progression.md. */
export const defaultCharXpCurve: FormulaRef = {
  kind: "char_xp_curve_v1",
  ...defaultProgressionXpParams,
};

/** Skill XP curve currently mirrors the character curve but keeps its own
 *  formula kind so tuning can diverge later without touching character saves. */
export const defaultSkillXpCurve: FormulaRef = {
  kind: "skill_xp_curve_v1",
  ...defaultProgressionXpParams,
};

const authoredFormulas = {} satisfies Record<string, AuthoringDef<FormulaRef>>;

export const formulas = compileInheritedCollection<FormulaRef>({
  bucketName: "formulas",
  defs: authoredFormulas,
  ensureIdField: false,
});
