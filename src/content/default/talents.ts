import type { TalentDef, TalentId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import {
  knightFortitude,
  knightGuard,
  knightPowerStrike,
  knightRage,
  knightRetaliation,
  knightWarcry,
} from "../behaviors/talents/knight";
import {
  monsterBasicAttack,
  monsterMagicAttack,
} from "../behaviors/talents/monster";
import { magicStrikeEffect, strikeEffect } from "./effects";

export const basicAttackTalent: TalentDef = {
  id: "talent.basic.attack" as TalentId,
  name: "攻击",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    mpCost: 0,
    cooldownActions: 0,
    energyCost: 1000,
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
    mpCost: 0,
    cooldownActions: 0,
    energyCost: 1000,
    targetKind: "single_enemy" as const,
  }),
  effects: [magicStrikeEffect.id],
};

const authoredTalents = {
  [basicAttackTalent.id]: basicAttackTalent,
  [magicBasicAttackTalent.id]: magicBasicAttackTalent,
  [monsterBasicAttack.id]: monsterBasicAttack,
  [monsterMagicAttack.id]: monsterMagicAttack,
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
  monsterBasicAttack,
  monsterMagicAttack,
};
