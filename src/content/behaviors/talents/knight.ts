// Knight talents.
//
// Six total:
//   1. 重击 (Power Strike)  — active, high-coeff single physical hit
//   2. 坚韧 (Fortitude id)  — passive, +MAX_HP% and +HP_REGEN
//   3. 反击 (Retaliation)   — passive, chance to counter-attack after taking damage
//   4. 狂怒 (Rage)          — sustain, +PATK% -PDEF%
//   5. 守护 (Guard)         — sustain, +PDEF% -PATK%, proxy damage
//   6. 战吼 (Warcry)        — active, self-buff +AGGRO_WEIGHT +flat PDEF

import {
  createTalentStaticContext,
  type TalentDef,
  type TalentExecutionContext,
  type TalentId,
  type TalentStaticContext,
  type EffectApplication,
} from "../../../core/content";
import type { Character } from "../../../core/entity/actor/types";
import { isPlayer } from "../../../core/entity/actor/types";
import { fromToLinear, fromToSqrt, pctStr, fmtNum } from "../scaling";
import {
  knightFortitudeEffect,
  knightRetaliationEffect,
  knightRageEffect,
  knightGuardEffect,
  knightWarcryEffect,
} from "../effects/knight";

// ---------- 1. Power Strike ----------

const powerStrikeCoeff = fromToSqrt(1.5, 2.0);
const powerStrikeMpCost = fromToLinear(4, 8);

function powerStrikeParams(ctx: TalentStaticContext) {
  return {
    coeff: powerStrikeCoeff(ctx.level),
    mpCost: Math.round(powerStrikeMpCost(ctx.level)),
  };
}

export const knightPowerStrike: TalentDef = {
  id: "talent.knight.power_strike" as TalentId,
  name: "重击",
  description: "高系数单体物理攻击。",
  type: "active",
  maxLevel: 10,
  tpCost: 1,
  intentPriority: 20,
  getActiveParams: (ctx) => ({
    mpCost: powerStrikeParams(ctx).mpCost,
    cooldownActions: 2,
    targetKind: "single_enemy" as const,
  }),
  execute: (ctx: TalentExecutionContext) => {
    ctx.dealPhysicalDamage(ctx.targets[0]!, powerStrikeParams(ctx).coeff);
  },
  describe: (ctx: TalentStaticContext) => {
    const p = powerStrikeParams(ctx);
    return `伤害系数 ${fmtNum(p.coeff)}x`;
  },
};

// ---------- 2. Fortitude ----------

const fortitudeHpPct = fromToSqrt(0.05, 0.45);
const fortitudeHpRegen = fromToLinear(4.0, 40.0);

function fortitudeParams(ctx: TalentStaticContext) {
  return { hpPct: fortitudeHpPct(ctx.level), hpRegen: fortitudeHpRegen(ctx.level) };
}

export const knightFortitude: TalentDef = {
  id: "talent.knight.fortitude" as TalentId,
  name: "坚韧",
  description: "被动强化体魄，提高生命上限和生命回复。",
  type: "passive",
  maxLevel: 10,
  tpCost: 1,
  getEffectParams: (ctx) => fortitudeParams(ctx),
  grantEffects: (level: number, owner: Character): EffectApplication[] => [{
    effectId: knightFortitudeEffect.id,
    state: fortitudeParams(createTalentStaticContext(level, isPlayer(owner) ? owner : null)),
  }],
  describe: (ctx: TalentStaticContext) => {
    const p = fortitudeParams(ctx);
    return `生命 +${pctStr(p.hpPct)}，生命回复 +${fmtNum(p.hpRegen, 1)}`;
  },
};

// ---------- 3. Retaliation ----------

const retaliationChance = 0.25;
const retaliationDmgRatio = fromToSqrt(0.50, 0.90);

function retaliationParams(ctx: TalentStaticContext) {
  return { chance: retaliationChance, dmgRatio: retaliationDmgRatio(ctx.level) };
}

export const knightRetaliation: TalentDef = {
  id: "talent.knight.retaliation" as TalentId,
  name: "反击",
  description: "受到物理攻击且实际受伤后，有概率进行一次反击。",
  type: "passive",
  maxLevel: 10,
  tpCost: 1,
  prereqs: [{ talentId: "talent.knight.warcry" as TalentId, minLevel: 5 }],
  getEffectParams: (ctx) => retaliationParams(ctx),
  grantEffects: (level: number, owner: Character): EffectApplication[] => [{
    effectId: knightRetaliationEffect.id,
    state: retaliationParams(createTalentStaticContext(level, isPlayer(owner) ? owner : null)),
  }],
  describe: (ctx: TalentStaticContext) => {
    const p = retaliationParams(ctx);
    return `反击概率 ${pctStr(p.chance)}，反击伤害 ${pctStr(p.dmgRatio)} PATK`;
  },
};

// ---------- 4. Rage ----------

const rageAtkPct = fromToSqrt(0.08, 0.40);
const rageDefPct = fromToSqrt(-0.05, -0.25);

function rageParams(ctx: TalentStaticContext) {
  return { atkPct: rageAtkPct(ctx.level), defPct: rageDefPct(ctx.level) };
}

export const knightRage: TalentDef = {
  id: "talent.knight.rage" as TalentId,
  name: "狂怒",
  description: "姿态：提高攻击力，降低防御。与「守护」互斥。",
  type: "sustain",
  maxLevel: 10,
  tpCost: 1,
  prereqs: [{ talentId: "talent.knight.power_strike" as TalentId, minLevel: 5 }],
  exclusiveGroup: "knight.stance",
  getEffectParams: (ctx) => rageParams(ctx),
  grantEffects: (level: number, owner: Character): EffectApplication[] => [{
    effectId: knightRageEffect.id,
    state: rageParams(createTalentStaticContext(level, isPlayer(owner) ? owner : null)),
  }],
  describe: (ctx: TalentStaticContext) => {
    const p = rageParams(ctx);
    return `物攻 +${pctStr(p.atkPct)}，物防 ${pctStr(p.defPct)}`;
  },
};

// ---------- 5. Guard ----------

const guardDefPct = fromToSqrt(0.08, 0.40);
const guardAtkPct = fromToSqrt(-0.05, -0.25);
const guardProxyChance = fromToSqrt(0.20, 0.45);

function guardParams(ctx: TalentStaticContext) {
  return { defPct: guardDefPct(ctx.level), atkPct: guardAtkPct(ctx.level), proxyChance: guardProxyChance(ctx.level) };
}

export const knightGuard: TalentDef = {
  id: "talent.knight.guard" as TalentId,
  name: "守护",
  description: "姿态：提高防御，降低攻击力。概率替盟友承受伤害。与「狂怒」互斥。",
  type: "sustain",
  maxLevel: 10,
  tpCost: 1,
  prereqs: [{ talentId: "talent.knight.fortitude" as TalentId, minLevel: 5 }],
  exclusiveGroup: "knight.stance",
  getEffectParams: (ctx) => guardParams(ctx),
  grantEffects: (level: number, owner: Character): EffectApplication[] => [{
    effectId: knightGuardEffect.id,
    state: guardParams(createTalentStaticContext(level, isPlayer(owner) ? owner : null)),
  }],
  describe: (ctx: TalentStaticContext) => {
    const p = guardParams(ctx);
    return `物防 +${pctStr(p.defPct)}，物攻 ${pctStr(p.atkPct)}，代伤概率 ${pctStr(p.proxyChance)}`;
  },
};

// ---------- 6. Warcry ----------

const warcryAggroPct = fromToSqrt(2.0, 10.0);
const warcryDefFlat = fromToSqrt(1.0, 6.0);

function warcryParams(ctx: TalentStaticContext) {
  return { aggroPct: warcryAggroPct(ctx.level), defFlat: warcryDefFlat(ctx.level) };
}

export const knightWarcry: TalentDef = {
  id: "talent.knight.warcry" as TalentId,
  name: "战吼",
  description: "对自身施加嘲讽 buff，提高仇恨权重并获得额外护甲。",
  type: "active",
  maxLevel: 10,
  tpCost: 1,
  prereqs: [{ talentId: "talent.knight.fortitude" as TalentId, minLevel: 5 }],
  intentPriority: 10,
  getActiveParams: () => ({
    mpCost: 12,
    cooldownActions: 4,
    actionCostRatio: 0.8,
    targetKind: "self" as const,
  }),
  getEffectParams: (ctx) => warcryParams(ctx),
  execute: (ctx: TalentExecutionContext) => {
    ctx.applyEffect(knightWarcryEffect.id, ctx.caster, warcryParams(ctx));
  },
  describe: (ctx: TalentStaticContext) => {
    const p = warcryParams(ctx);
    const aggroStr = `${Math.round(p.aggroPct * 100)}%`;
    return `仇恨 +${aggroStr}，物防 +${fmtNum(p.defFlat, 1)}，持续 3 回合`;
  },
};
