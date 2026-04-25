// Monster-specific talents.
//
// 目前仅保留怪物专用的魔法普攻；物理普攻直接复用通用基础攻击。

import type { TalentDef, TalentId, EffectId } from "../../../core/content/types";

export const monsterMagicAttack: TalentDef = {

  id: "talent.monster.magic_attack" as TalentId,
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
  effects: ["effect.combat.magic_strike" as EffectId],
};
