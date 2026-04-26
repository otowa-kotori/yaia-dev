// Knight effect definitions.
//
// These EffectDefs are installed by knight passive/sustain talents via
// grantEffects, and by active talents (Warcry) via execute → applyEffect.
// Registered in ContentDb.effects so the dispatch engine can look them up.
//
// Effects read concrete values from state (set by TalentDef.getEffectParams),
// NOT talent level. This keeps effects reusable by different sources.

import type { EffectDef, EffectId } from "../../../core/content/types";
import type { ReactionHooks } from "../../../core/combat/reaction/types";
import { ATTR } from "../../../core/entity/attribute";

// ---------- Fortitude ----------
//
// Passive buff: +HP% and +HP_REGEN from state.hpPct / state.hpRegen.

export const knightFortitudeEffect: EffectDef = {
  id: "effect.knight.fortitude" as EffectId,
  name: "坚韧",
  kind: "duration",
  durationActions: 1, // overridden to -1 (infinite) at install
  computeModifiers: (state) => {
    const hpPct = (state.hpPct as number) ?? 0.05;
    const hpRegen = (state.hpRegen as number) ?? 1.0;
    return [
      { stat: ATTR.MAX_HP, op: "pct_add", value: hpPct, sourceId: "" },
      { stat: ATTR.HP_REGEN, op: "flat", value: hpRegen, sourceId: "" },
    ];
  },
  tags: ["passive", "knight"],
};

// ---------- Retaliation ----------
//
// Passive effect with an after_damage_taken reaction hook.
// On physical hit taken, rolls state.chance to deal state.dmgRatio × PATK back.

export const knightRetaliationEffect: EffectDef = {
  id: "effect.knight.retaliation" as EffectId,
  name: "反击",
  kind: "duration",
  durationActions: 1,
  tags: ["passive", "knight"],
  reactions: {
    after_damage_taken: (owner, event, state, ctx) => {
      if (event.damageType !== "physical") return;
      if (event.damage <= 0) return;
      if (event.attacker.currentHp <= 0) return;

      const chance = (state.chance as number) ?? 0.25;
      if (ctx.rng.next() >= chance) return;

      const dmgRatio = (state.dmgRatio as number) ?? 0.5;
      ctx.dealPhysicalDamage(owner, event.attacker, dmgRatio);
    },
  } as ReactionHooks,
};

// ---------- Rage ----------
//
// Sustain stance: +PATK%, -PDEF% from state.atkPct / state.defPct.

export const knightRageEffect: EffectDef = {
  id: "effect.knight.rage" as EffectId,
  name: "狂怒",
  kind: "duration",
  durationActions: 1,
  computeModifiers: (state) => {
    const atkPct = (state.atkPct as number) ?? 0.08;
    const defPct = (state.defPct as number) ?? -0.05;
    return [
      { stat: ATTR.PATK, op: "pct_add", value: atkPct, sourceId: "" },
      { stat: ATTR.PDEF, op: "pct_add", value: defPct, sourceId: "" },
    ];
  },
  tags: ["sustain", "knight"],
};

// ---------- Guard ----------
//
// Sustain stance: +PDEF%, -PATK% from state. Also has on_ally_damaged
// reaction: state.proxyChance to proxy 50% damage.

export const knightGuardEffect: EffectDef = {
  id: "effect.knight.guard" as EffectId,
  name: "守护",
  kind: "duration",
  durationActions: 1,
  computeModifiers: (state) => {
    const defPct = (state.defPct as number) ?? 0.08;
    const atkPct = (state.atkPct as number) ?? -0.05;
    return [
      { stat: ATTR.PDEF, op: "pct_add", value: defPct, sourceId: "" },
      { stat: ATTR.PATK, op: "pct_add", value: atkPct, sourceId: "" },
    ];
  },
  tags: ["sustain", "knight"],
  reactions: {
    on_ally_damaged: (owner, event, state, ctx) => {
      if (event.ally === owner) return;
      if (owner.currentHp <= 0) return;

      const chance = (state.proxyChance as number) ?? 0.2;
      if (ctx.rng.next() >= chance) return;

      const proxyRatio = 0.5;
      const proxyAmount = Math.floor(event.damage * proxyRatio);
      if (proxyAmount <= 0) return;

      ctx.healTarget(event.ally, proxyAmount);
      ctx.dealDamage(event.attacker, owner, proxyAmount, "physical");
    },
  } as ReactionHooks,
};

// ---------- Warcry ----------
//
// Active skill buff: single duration effect, modifiers from state.aggroPct / state.defFlat.
// Duration: 3 action counts.

export const knightWarcryEffect: EffectDef = {
  id: "effect.knight.warcry" as EffectId,
  name: "战吼",
  kind: "duration",
  durationActions: 3,
  computeModifiers: (state) => {
    const aggroPct = (state.aggroPct as number) ?? 2.0;
    const defFlat = (state.defFlat as number) ?? 1.0;
    return [
      { stat: ATTR.AGGRO_WEIGHT, op: "pct_add", value: aggroPct, sourceId: "" },
      { stat: ATTR.PDEF, op: "flat", value: defFlat, sourceId: "" },
    ];
  },
  tags: ["active", "knight", "buff"],
};
