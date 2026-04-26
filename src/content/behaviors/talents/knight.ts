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
  CastContext,
  EffectApplication,
  TalentDescribeContext,
} from "../../../core/content/types";
import type { Character } from "../../../core/entity/actor/types";
import { fromTo, pctStr, fmtNum } from "../scaling";
import {
  knightFortitudeEffect,
  knightRetaliationEffect,
  knightRageEffect,
  knightGuardEffect,
  knightWarcryEffect,
} from "../effects/knight";

// ---------- 1. Power Strike ----------

const powerStrikeCoeff = fromTo(1.34, 1.70);

export const knightPowerStrike: TalentDef = {
  id: "talent.knight.power_strike" as TalentId,
  name: "重击",
  description: "高系数单体物理攻击。",
  type: "active",
  maxLevel: 10,
  tpCost: 1,
  intentPriority: 20,
  getActiveParams: (_level: number) => ({
    mpCost: 8,
    cooldownActions: 0,
    energyCost: 1000,
    targetKind: "single_enemy" as const,
  }),
  execute: (level: number, caster: Character, targets: Character[], ctx: CastContext) => {
    ctx.dealPhysicalDamage(caster, targets[0]!, powerStrikeCoeff(level));
  },
  describe: (ctx: TalentDescribeContext) => {
    const coeff = fmtNum(powerStrikeCoeff(ctx.level));
    return `伤害系数 ${coeff}x，MP 消耗 8`;
  },
};

// ---------- 2. Fortitude ----------

const fortitudeHpPct = fromTo(0.05, 0.45);
const fortitudeDefPct = fromTo(0.03, 0.27);

function fortitudeParams(level: number) {
  return { hpPct: fortitudeHpPct(level), defPct: fortitudeDefPct(level) };
}

export const knightFortitude: TalentDef = {
  id: "talent.knight.fortitude" as TalentId,
  name: "坚守",
  description: "被动强化体质，提高生命上限和物理防御。",
  type: "passive",
  maxLevel: 10,
  tpCost: 1,
  getEffectParams: (level) => fortitudeParams(level),
  grantEffects: (level: number, _owner: Character): EffectApplication[] => [{
    effectId: knightFortitudeEffect.id,
    state: fortitudeParams(level),
  }],
  describe: (ctx: TalentDescribeContext) => {
    const p = fortitudeParams(ctx.level);
    return `生命 +${pctStr(p.hpPct)}，物防 +${pctStr(p.defPct)}`;
  },
};

// ---------- 3. Retaliation ----------

const retaliationChance = fromTo(0.20, 0.60);
const retaliationDmgRatio = fromTo(0.50, 0.90);

function retaliationParams(level: number) {
  return { chance: retaliationChance(level), dmgRatio: retaliationDmgRatio(level) };
}

export const knightRetaliation: TalentDef = {
  id: "talent.knight.retaliation" as TalentId,
  name: "反击",
  description: "受到物理攻击后，有概率进行一次反击。",
  type: "passive",
  maxLevel: 10,
  tpCost: 1,
  prereqs: [{ talentId: "talent.knight.fortitude" as TalentId, minLevel: 1 }],
  getEffectParams: (level) => retaliationParams(level),
  grantEffects: (level: number, _owner: Character): EffectApplication[] => [{
    effectId: knightRetaliationEffect.id,
    state: retaliationParams(level),
  }],
  describe: (ctx: TalentDescribeContext) => {
    const p = retaliationParams(ctx.level);
    return `反击概率 ${pctStr(p.chance)}，反击伤害 ${pctStr(p.dmgRatio)} PATK`;
  },
};

// ---------- 4. Rage ----------

const rageAtkPct = fromTo(0.08, 0.40);
const rageDefPct = fromTo(-0.05, -0.25);

function rageParams(level: number) {
  return { atkPct: rageAtkPct(level), defPct: rageDefPct(level) };
}

export const knightRage: TalentDef = {
  id: "talent.knight.rage" as TalentId,
  name: "狂怒",
  description: "姿态：提高攻击力，降低防御。与「守护」互斥。",
  type: "sustain",
  maxLevel: 10,
  tpCost: 1,
  exclusiveGroup: "knight.stance",
  getEffectParams: (level) => rageParams(level),
  grantEffects: (level: number, _owner: Character): EffectApplication[] => [{
    effectId: knightRageEffect.id,
    state: rageParams(level),
  }],
  describe: (ctx: TalentDescribeContext) => {
    const p = rageParams(ctx.level);
    return `物攻 +${pctStr(p.atkPct)}，物防 ${pctStr(p.defPct)}`;
  },
};

// ---------- 5. Guard ----------

const guardDefPct = fromTo(0.08, 0.40);
const guardAtkPct = fromTo(-0.05, -0.25);
const guardProxyChance = fromTo(0.20, 0.45);

function guardParams(level: number) {
  return { defPct: guardDefPct(level), atkPct: guardAtkPct(level), proxyChance: guardProxyChance(level) };
}

export const knightGuard: TalentDef = {
  id: "talent.knight.guard" as TalentId,
  name: "守护",
  description: "姿态：提高防御，降低攻击力。概率替盟友承受伤害。与「狂怒」互斥。",
  type: "sustain",
  maxLevel: 10,
  tpCost: 1,
  exclusiveGroup: "knight.stance",
  getEffectParams: (level) => guardParams(level),
  grantEffects: (level: number, _owner: Character): EffectApplication[] => [{
    effectId: knightGuardEffect.id,
    state: guardParams(level),
  }],
  describe: (ctx: TalentDescribeContext) => {
    const p = guardParams(ctx.level);
    return `物防 +${pctStr(p.defPct)}，物攻 ${pctStr(p.atkPct)}，代伤概率 ${pctStr(p.proxyChance)}`;
  },
};

// ---------- 6. Warcry ----------

const warcryAggroPct = fromTo(2.0, 10.0);
const warcryDefPct = fromTo(0.08, 0.40);

function warcryParams(level: number) {
  return { aggroPct: warcryAggroPct(level), defPct: warcryDefPct(level) };
}

export const knightWarcry: TalentDef = {
  id: "talent.knight.warcry" as TalentId,
  name: "战吼",
  description: "对自身施加嘲讽 buff，大幅提高仇恨权重，吸引敌人攻击。",
  type: "active",
  maxLevel: 10,
  tpCost: 1,
  prereqs: [{ talentId: "talent.knight.fortitude" as TalentId, minLevel: 2 }],
  intentPriority: 10,
  getActiveParams: (_level: number) => ({
    mpCost: 12,
    cooldownActions: 4,
    energyCost: 800,
    targetKind: "self" as const,
  }),
  getEffectParams: (level) => warcryParams(level),
  execute: (level: number, caster: Character, _targets: Character[], ctx: CastContext) => {
    ctx.applyEffect(knightWarcryEffect.id, caster, caster, warcryParams(level));
  },
  describe: (ctx: TalentDescribeContext) => {
    const p = warcryParams(ctx.level);
    const aggroStr = `${Math.round(p.aggroPct * 100)}%`;
    return `仇恨 +${aggroStr}，物防 +${pctStr(p.defPct)}，持续 3 回合，CD 4`;
  },
};
