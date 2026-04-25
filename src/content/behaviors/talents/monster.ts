// Monster default talents.
//
// Monsters use TalentDef like players. These are simple "attack" talents
// with no leveling, no TP cost, and a declarative effects[] shortcut.

import type { TalentDef, TalentId, EffectId } from "../../../core/content/types";

export const monsterBasicAttack: TalentDef = {
  id: "talent.monster.basic_attack" as TalentId,
  name: "普通攻击",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    mpCost: 0,
    cooldownActions: 0,
    energyCost: 1000,
    targetKind: "single_enemy" as const,
  }),
  effects: ["effect.combat.strike" as EffectId],
};

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
