import type { SkillDef, SkillId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { defaultSkillXpCurve } from "./formulas";

export const miningSkill: SkillDef = {
  id: "skill.mining" as SkillId,
  name: "采矿",
  xpCurve: defaultSkillXpCurve,
  maxLevel: 99,
};

export const smithingSkill: SkillDef = {
  id: "skill.smithing" as SkillId,
  name: "锻造",
  xpCurve: defaultSkillXpCurve,
  maxLevel: 99,
};

const authoredSkills = {
  [miningSkill.id]: miningSkill,
  [smithingSkill.id]: smithingSkill,
} satisfies Record<string, AuthoringDef<SkillDef>>;

export const skills = compileInheritedCollection<SkillDef>({
  bucketName: "skills",
  defs: authoredSkills,
});
