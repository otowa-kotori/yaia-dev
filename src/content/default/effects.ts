import { ATTR } from "../../core/entity/attribute";
import type { EffectDef, EffectId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import {
  knightFortitudeEffect,
  knightGuardEffect,
  knightRageEffect,
  knightRetaliationEffect,
  knightWarcryEffect,
} from "../behaviors/effects/knight";

/** return-to-line 物理伤害方案，详见 docs/design/combat-formula.md §2。 */
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

/**
 * 活动层临时挂载的阶段恢复 effect。
 *
 * 它不依赖 action 过期，而是由 CombatActivity / DungeonActivity 在 phase
 * 进入时安装、离开时移除。effect 只是统一承载“临时加自回”的 modifier 形态，
 * 真正的回复发生在每个 logic tick 读取 HP_REGEN / MP_REGEN 时。
 */
export const phaseRecoveryEffect: EffectDef = {
  id: "effect.system.phase_recovery" as EffectId,
  kind: "duration",
  computeModifiers: (state) => {
    const hpRegen = Math.max(0, Number(state.hpRegen ?? 0));
    const mpRegen = Math.max(0, Number(state.mpRegen ?? 0));
    return [
      { stat: ATTR.HP_REGEN, op: "flat" as const, value: hpRegen, sourceId: "" },
      { stat: ATTR.MP_REGEN, op: "flat" as const, value: mpRegen, sourceId: "" },
    ].filter((modifier) => modifier.value > 0);
  },
};

const authoredEffects = {
  [strikeEffect.id]: strikeEffect,
  [magicStrikeEffect.id]: magicStrikeEffect,
  [phaseRecoveryEffect.id]: phaseRecoveryEffect,
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
