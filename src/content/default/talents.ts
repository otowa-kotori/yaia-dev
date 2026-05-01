import type { TalentDef, TalentExecutionContext, TalentId } from "../../core/content";
import { getAttr } from "../../core/entity/actor";
import { ATTR } from "../../core/entity/attribute";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import {
  knightFortitude,
  knightGuard,
  knightPowerStrike,
  knightRage,
  knightRetaliation,
  knightWarcry,
} from "../behaviors/talents/knight";
import { magicStrikeEffect, strikeEffect } from "./effects";

export const basicAttackTalent: TalentDef = {
  id: "talent.basic.attack" as TalentId,
  name: "攻击",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    targetKind: "single_enemy" as const,
  }),
  effects: [strikeEffect.id],
};


/** 魔法基础攻击——法师/圣女平A使用。 */
export const magicBasicAttackTalent: TalentDef = {
  id: "talent.basic.magic_attack" as TalentId,
  name: "魔法攻击",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    targetKind: "single_enemy" as const,
  }),
  effects: [magicStrikeEffect.id],
};

/** 魔法剑：混合物/法面板攻击。 */
export const magicBladeTalent: TalentDef = {
  id: "talent.active.magic_blade" as TalentId,
  name: "魔法剑",
  description: "灌注魔力的斩击，伤害附加50%的魔法攻击力。",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  intentPriority: 15,
  getActiveParams: () => ({
    mpCost: 0,
    cooldownActions: 3,
    targetKind: "single_enemy" as const,
  }),
  execute: (ctx: TalentExecutionContext) => {
    const patk = getAttr(ctx.caster, ATTR.PATK);
    const matk = getAttr(ctx.caster, ATTR.MATK);
    const blendedPatk = Math.floor(patk * 1 + matk * 0.5);
    for (const target of ctx.targets) {
      ctx.dealPhysicalDamage(target, 1, { patkOverride: blendedPatk });
    }
  },
};


const authoredTalents = {
  [basicAttackTalent.id]: basicAttackTalent,
  [magicBasicAttackTalent.id]: magicBasicAttackTalent,
  [magicBladeTalent.id]: magicBladeTalent,
  [knightPowerStrike.id]: knightPowerStrike,
  [knightFortitude.id]: knightFortitude,
  [knightRetaliation.id]: knightRetaliation,
  [knightRage.id]: knightRage,
  [knightGuard.id]: knightGuard,
  [knightWarcry.id]: knightWarcry,
} satisfies Record<string, AuthoringDef<TalentDef>>;

export const talents = compileInheritedCollection<TalentDef>({
  bucketName: "talents",
  defs: authoredTalents,
});

export {
  knightFortitude,
  knightGuard,
  knightPowerStrike,
  knightRage,
  knightRetaliation,
  knightWarcry,
};
