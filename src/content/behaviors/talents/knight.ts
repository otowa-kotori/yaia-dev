// Knight talents.
//
// Phase 1: only Power Strike. Remaining 5 talents added in future phases.

import type { TalentDef, TalentId, CastContext } from "../../../core/content/types";
import type { Character } from "../../../core/entity/actor/types";

export const knightPowerStrike: TalentDef = {
  id: "talent.knight.power_strike" as TalentId,
  name: "重击",
  description: "高系数单体物理攻击。",
  type: "active",
  maxLevel: 10,
  tpCost: 1,
  getActiveParams: (level: number) => ({
    mpCost: 8,
    cooldownActions: 0,
    energyCost: 1000,
    targetKind: "single_enemy" as const,
  }),
  execute: (level: number, caster: Character, targets: Character[], ctx: CastContext) => {
    const coeff = 1.3 + level * 0.04;
    ctx.dealPhysicalDamage(caster, targets[0]!, coeff);
  },
};
