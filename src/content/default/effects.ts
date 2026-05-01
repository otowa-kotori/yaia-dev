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

/** 全局脱战恢复模板：按最大生命/法力百分比每秒恢复。 */
export const outOfCombatRecoveryEffect: EffectDef = {
  id: "effect.system.out_of_combat_recovery" as EffectId,
  kind: "duration",
  modifiers: [
    {
      stat: ATTR.OUT_OF_COMBAT_HP_PCT_PER_SECOND,
      op: "flat",
      value: 0.05,
      sourceId: "",
    },
    {
      stat: ATTR.OUT_OF_COMBAT_MP_PCT_PER_SECOND,
      op: "flat",
      value: 0.05,
      sourceId: "",
    },
  ],
};

/** 战斗区搜怪恢复：继承全局脱战模板。 */
export const combatSearchRecoveryEffect = {
  extends: outOfCombatRecoveryEffect.id,
  id: "effect.system.combat_search_recovery" as EffectId,
  kind: "duration",
} satisfies AuthoringDef<EffectDef>;

/** 副本波间恢复：继承全局脱战模板并覆盖幅度。 */
export const dungeonWaveRestRecoveryEffect = {
  extends: outOfCombatRecoveryEffect.id,
  id: "effect.system.dungeon_wave_rest_recovery" as EffectId,
  kind: "duration",
  modifiers: [
    {
      stat: ATTR.OUT_OF_COMBAT_HP_PCT_PER_SECOND,
      op: "flat",
      value: 0.075,
      sourceId: "",
    },
    {
      stat: ATTR.OUT_OF_COMBAT_MP_PCT_PER_SECOND,
      op: "flat",
      value: 0.075,
      sourceId: "",
    },
  ],
} satisfies AuthoringDef<EffectDef>;

const authoredEffects = {
  [strikeEffect.id]: strikeEffect,
  [magicStrikeEffect.id]: magicStrikeEffect,
  [outOfCombatRecoveryEffect.id]: outOfCombatRecoveryEffect,
  [combatSearchRecoveryEffect.id]: combatSearchRecoveryEffect,
  [dungeonWaveRestRecoveryEffect.id]: dungeonWaveRestRecoveryEffect,
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
