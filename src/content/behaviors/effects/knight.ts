// Knight effect definitions.
//
// These EffectDefs are installed by knight passive/sustain talents via
// grantEffects, and by active talents (Warcry) via execute → applyEffect.
// Registered in ContentDb.effects so the dispatch engine can look them up.
//
// Modifier scaling: effects use computeModifiers(state) to read state.level
// and produce level-appropriate modifier values. Each talent installs exactly
// one EffectInstance — no N-copy stacking.

import type { EffectDef, EffectId } from "../../../core/content/types";
import type { ReactionHooks } from "../../../core/combat/reaction/types";
import { ATTR } from "../../../core/entity/attribute";

// ---------- Fortitude ----------
//
// Passive buff: +HP% and +PDEF% scaling with talent level.
// Level N: MAX_HP pct_add +N*5%, PDEF pct_add +N*3%.

export const knightFortitudeEffect: EffectDef = {
  id: "effect.knight.fortitude" as EffectId,
  name: "坚守",
  kind: "duration",
  durationActions: 1, // overridden to -1 (infinite) at install
  computeModifiers: (state) => {
    const level = (state.level as number) ?? 1;
    return [
      { stat: ATTR.MAX_HP, op: "pct_add", value: level * 0.05, sourceId: "" },
      { stat: ATTR.PDEF,   op: "pct_add", value: level * 0.03, sourceId: "" },
    ];
  },
  tags: ["passive", "knight"],
};

// ---------- Retaliation ----------
//
// Passive effect with an after_damage_taken reaction hook.
// On physical hit taken, rolls a chance to deal flat damage back to attacker.
// Chance and damage scale with talent level (read from state.level):
//   chance = 0.10 + level * 0.10  (20%/30%/40%/50%/60%)
//   damage = PATK * (0.40 + level * 0.10)

export const knightRetaliationEffect: EffectDef = {
  id: "effect.knight.retaliation" as EffectId,
  name: "反击",
  kind: "duration",
  durationActions: 1,
  tags: ["passive", "knight"],
  reactions: {
    after_damage_taken: (owner, event, state, ctx) => {
      if (event.damageType !== "physical") return;
      if (event.attacker.currentHp <= 0) return;

      const level = (state.level as number) ?? 1;
      const chance = 0.10 + level * 0.10;
      if (ctx.rng.next() >= chance) return;

      const dmgRatio = 0.40 + level * 0.10;
      ctx.dealPhysicalDamage(owner, event.attacker, dmgRatio);
    },
  } as ReactionHooks,
};

// ---------- Rage ----------
//
// Sustain stance: +PATK%, -PDEF%. Level N: PATK +N*8%, PDEF -N*5%.

export const knightRageEffect: EffectDef = {
  id: "effect.knight.rage" as EffectId,
  name: "狂怒",
  kind: "duration",
  durationActions: 1,
  computeModifiers: (state) => {
    const level = (state.level as number) ?? 1;
    return [
      { stat: ATTR.PATK, op: "pct_add", value: level * 0.08, sourceId: "" },
      { stat: ATTR.PDEF,  op: "pct_add", value: level * -0.05, sourceId: "" },
    ];
  },
  tags: ["sustain", "knight"],
};

// ---------- Guard ----------
//
// Sustain stance: +PDEF%, -PATK%. Level N: PDEF +N*8%, PATK -N*5%.
// Also has on_ally_damaged reaction: chance to proxy damage.

export const knightGuardEffect: EffectDef = {
  id: "effect.knight.guard" as EffectId,
  name: "守护",
  kind: "duration",
  durationActions: 1,
  computeModifiers: (state) => {
    const level = (state.level as number) ?? 1;
    return [
      { stat: ATTR.PDEF,  op: "pct_add", value: level * 0.08, sourceId: "" },
      { stat: ATTR.PATK, op: "pct_add", value: level * -0.05, sourceId: "" },
    ];
  },
  tags: ["sustain", "knight"],
  reactions: {
    on_ally_damaged: (owner, event, state, ctx) => {
      if (event.ally === owner) return;
      if (owner.currentHp <= 0) return;

      const level = (state.level as number) ?? 1;
      const chance = 0.15 + level * 0.05;
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
// Active skill buff: single duration effect, modifiers scale with level.
// Duration: 3 action counts.
// Level N: AGGRO_WEIGHT pct_add +N*2.0, PDEF pct_add +N*0.08.

export const knightWarcryEffect: EffectDef = {
  id: "effect.knight.warcry" as EffectId,
  name: "战吼",
  kind: "duration",
  durationActions: 3,
  computeModifiers: (state) => {
    const level = (state.level as number) ?? 1;
    return [
      { stat: ATTR.AGGRO_WEIGHT, op: "pct_add", value: level * 2.0, sourceId: "" },
      { stat: ATTR.PDEF, op: "pct_add", value: level * 0.08, sourceId: "" },
    ];
  },
  tags: ["active", "knight", "buff"],
};
