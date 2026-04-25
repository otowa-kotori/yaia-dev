import type { EffectDef, EffectId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import {
  knightFortitudeEffect,
  knightGuardEffect,
  knightRageEffect,
  knightRetaliationEffect,
  knightWarcryEffect,
} from "../behaviors/effects/knight";

/** ratio-power 破甲方案，详见 docs/design/combat-formula.md §2。 */
export const strikeEffect: EffectDef = {
  id: "effect.combat.strike" as EffectId,
  kind: "instant",
  magnitudeMode: "damage",
  formula: { kind: "phys_damage_v1" },
};

/** 魔法基础攻击——法师/圣女平A使用。读 MATK，绕过 PDEF。 */
export const magicStrikeEffect: EffectDef = {
  id: "effect.combat.magic_strike" as EffectId,
  kind: "instant",
  magnitudeMode: "damage",
  formula: { kind: "magic_damage_v1" },
};

const authoredEffects = {
  [strikeEffect.id]: strikeEffect,
  [magicStrikeEffect.id]: magicStrikeEffect,
  [knightFortitudeEffect.id]: knightFortitudeEffect,
  [knightRetaliationEffect.id]: knightRetaliationEffect,
  [knightRageEffect.id]: knightRageEffect,
  [knightGuardEffect.id]: knightGuardEffect,
  [knightWarcryEffect.id]: knightWarcryEffect,
} satisfies Record<string, AuthoringDef<EffectDef>>;

export const effects = compileInheritedCollection<EffectDef>({
  bucketName: "effects",
  defs: authoredEffects,
});

export {
  knightFortitudeEffect,
  knightGuardEffect,
  knightRageEffect,
  knightRetaliationEffect,
  knightWarcryEffect,
};
