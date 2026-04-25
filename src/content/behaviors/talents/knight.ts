// Knight talents.
//
// Six total:
//   1. 重击 (Power Strike)  — active, high-coeff single physical hit
//   2. 坚守 (Fortitude)     — passive, +MAX_HP% and +PDEF%
//   3. 反击 (Retaliation)   — passive, chance to counter-attack after taking damage
//   4. 狂怒 (Rage)          — sustain, +PATK% -PDEF%
//   5. 守护 (Guard)         — sustain, +PDEF% -PATK%, proxy damage
//   6. 战吼 (Warcry)        — active, self-buff +AGGRO_WEIGHT +PDEF

import type {
  TalentDef,
  TalentId,
  EffectId,
  CastContext,
  EffectApplication,
} from "../../../core/content/types";
import type { Character } from "../../../core/entity/actor/types";
import { ATTR } from "../../../core/entity/attribute";
import {
  knightFortitudeEffect,
  knightRetaliationEffect,
  knightRageEffect,
  knightGuardEffect,
  knightWarcryEffect,
} from "../effects/knight";

// ---------- 1. Power Strike ----------

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
  describeLevel: (level: number) => {
    const coeff = (1.3 + level * 0.04).toFixed(2);
    return `伤害系数 ${coeff}x，MP 消耗 8`;
  },
};

// ---------- 2. Fortitude ----------

export const knightFortitude: TalentDef = {
  id: "talent.knight.fortitude" as TalentId,
  name: "坚守",
  description: "被动强化体质，提高生命上限和物理防御。",
  type: "passive",
  maxLevel: 5,
  tpCost: 2,
  grantEffects: (level: number, _owner: Character): EffectApplication[] => [{
    effectId: knightFortitudeEffect.id,
    state: { level },
  }],
  describeLevel: (level: number) => {
    const hpPct = level * 5;
    const defPct = level * 3;
    return `生命 +${hpPct}%，物防 +${defPct}%`;
  },
};

// ---------- 3. Retaliation ----------

export const knightRetaliation: TalentDef = {
  id: "talent.knight.retaliation" as TalentId,
  name: "反击",
  description: "受到物理攻击后，有概率进行一次反击。",
  type: "passive",
  maxLevel: 5,
  tpCost: 2,
  prereqs: [{ talentId: "talent.knight.fortitude" as TalentId, minLevel: 1 }],
  grantEffects: (level: number, _owner: Character): EffectApplication[] => [{
    effectId: knightRetaliationEffect.id,
    state: { level },
  }],
  describeLevel: (level: number) => {
    const chance = 10 + level * 10;
    const dmgPct = 40 + level * 10;
    return `反击概率 ${chance}%，反击伤害 ${dmgPct}% PATK`;
  },
};

// ---------- 4. Rage ----------

export const knightRage: TalentDef = {
  id: "talent.knight.rage" as TalentId,
  name: "狂怒",
  description: "姿态：提高攻击力，降低防御。与「守护」互斥。",
  type: "sustain",
  maxLevel: 5,
  tpCost: 2,
  exclusiveGroup: "knight.stance",
  grantEffects: (level: number, _owner: Character): EffectApplication[] => [{
    effectId: knightRageEffect.id,
    state: { level },
  }],
  describeLevel: (level: number) => {
    const atkPct = level * 8;
    const defPct = level * 5;
    return `物攻 +${atkPct}%，物防 -${defPct}%`;
  },
};

// ---------- 5. Guard ----------

export const knightGuard: TalentDef = {
  id: "talent.knight.guard" as TalentId,
  name: "守护",
  description: "姿态：提高防御，降低攻击力。概率替盟友承受伤害。与「狂怒」互斥。",
  type: "sustain",
  maxLevel: 5,
  tpCost: 2,
  exclusiveGroup: "knight.stance",
  grantEffects: (level: number, _owner: Character): EffectApplication[] => [{
    effectId: knightGuardEffect.id,
    state: { level },
  }],
  describeLevel: (level: number) => {
    const defPct = level * 8;
    const atkPct = level * 5;
    const proxyChance = 15 + level * 5;
    return `物防 +${defPct}%，物攻 -${atkPct}%，代伤概率 ${proxyChance}%`;
  },
};

// ---------- 6. Warcry ----------

export const knightWarcry: TalentDef = {
  id: "talent.knight.warcry" as TalentId,
  name: "战吼",
  description: "对自身施加嘲讽 buff，大幅提高仇恨权重，吸引敌人攻击。",
  type: "active",
  maxLevel: 5,
  tpCost: 2,
  prereqs: [{ talentId: "talent.knight.fortitude" as TalentId, minLevel: 2 }],
  getActiveParams: (level: number) => ({
    mpCost: 12,
    cooldownActions: 4,
    energyCost: 800,
    targetKind: "self" as const,
  }),
  execute: (level: number, caster: Character, _targets: Character[], ctx: CastContext) => {
    // Single effect instance with level in state → computeModifiers scales.
    ctx.applyEffect(knightWarcryEffect.id, caster, caster, { level });
  },
  describeLevel: (level: number) => {
    const aggroPct = level * 200;
    const defPct = level * 8;
    return `仇恨 +${aggroPct}%，物防 +${defPct}%，持续 3 回合，CD 4`;
  },
};
