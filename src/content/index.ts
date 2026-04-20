// Default MVP content bundle. Plain-data, kept deliberately minimal.
// Grow this file freely — it's the primary file designers will edit.

import { ATTR } from "../core/attribute";
import type {
  AbilityDef,
  AbilityId,
  AttrDef,
  EffectDef,
  EffectId,
  ItemDef,
  ItemId,
  MonsterDef,
  MonsterId,
  ContentDb,
  ResourceNodeDef,
  ResourceNodeId,
  SkillDef,
  SkillId,
  StageDef,
  StageId,
} from "../core/content";
import { emptyContentDb } from "../core/content";
import type { FormulaRef } from "../core/formula";

// ---------- Attributes ----------

const attrDefs: Record<string, AttrDef> = {
  [ATTR.MAX_HP]: {
    id: ATTR.MAX_HP,
    name: "Max HP",
    defaultBase: 50,
    integer: true,
    clampMin: 0,
  },
  [ATTR.MAX_MP]: {
    id: ATTR.MAX_MP,
    name: "Max MP",
    defaultBase: 10,
    integer: true,
    clampMin: 0,
  },
  [ATTR.ATK]: {
    id: ATTR.ATK,
    name: "Atk",
    defaultBase: 8,
    integer: true,
    clampMin: 0,
  },
  [ATTR.DEF]: {
    id: ATTR.DEF,
    name: "Def",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.STR]: { id: ATTR.STR, name: "Str", defaultBase: 5, integer: true },
  [ATTR.DEX]: { id: ATTR.DEX, name: "Dex", defaultBase: 5, integer: true },
  [ATTR.INT]: { id: ATTR.INT, name: "Int", defaultBase: 5, integer: true },
  [ATTR.WIS]: { id: ATTR.WIS, name: "Wis", defaultBase: 5, integer: true },
  [ATTR.CRIT_RATE]: {
    id: ATTR.CRIT_RATE,
    name: "Crit Rate",
    defaultBase: 0,
    clampMin: 0,
    clampMax: 1,
  },
  [ATTR.CRIT_MULT]: {
    id: ATTR.CRIT_MULT,
    name: "Crit Mult",
    defaultBase: 1.5,
    clampMin: 1,
  },
  [ATTR.SPEED]: {
    id: ATTR.SPEED,
    name: "Speed",
    defaultBase: 10,
    integer: true,
    clampMin: 1,
  },
};

// ---------- Formulas ----------

/** Character default XP curve: 25 * 1.2^(level-1). */
export const defaultCharXpCurve: FormulaRef = {
  kind: "exp_curve_v1",
  base: 25,
  growth: 1.2,
};

// ---------- Effects ----------

export const strikeEffect: EffectDef = {
  id: "effect.combat.strike" as EffectId,
  kind: "instant",
  magnitudeMode: "damage",
  formula: { kind: "atk_vs_def", atkMul: 1, defMul: 1 },
};

// ---------- Abilities ----------

export const basicAttack: AbilityDef = {
  id: "ability.basic.attack" as AbilityId,
  name: "Attack",
  targetKind: "single_enemy",
  effects: [strikeEffect.id],
};

// ---------- Monsters ----------

export const slime: MonsterDef = {
  id: "monster.slime" as MonsterId,
  name: "Slime",
  level: 1,
  baseAttrs: {
    [ATTR.MAX_HP]: 30,
    [ATTR.ATK]: 4,
    [ATTR.DEF]: 1,
    [ATTR.SPEED]: 5,
  },
  abilities: [basicAttack.id],
  drops: [],
  xpReward: 10,
};

// ---------- Items ----------

export const copperOre: ItemDef = {
  id: "item.ore.copper" as ItemId,
  name: "Copper Ore",
  stackable: true,
  tags: ["ore"],
};

// ---------- Skills ----------

/** Skill XP curve: same shape as char curve but a bit steeper so leveling a
 *  skill feels distinct from leveling character. Tuning pass later. */
export const defaultSkillXpCurve: FormulaRef = {
  kind: "exp_curve_v1",
  base: 15,
  growth: 1.15,
};

export const miningSkill: SkillDef = {
  id: "skill.mining" as SkillId,
  name: "Mining",
  xpCurve: defaultSkillXpCurve,
  maxLevel: 99,
};

// ---------- Resource Nodes ----------

export const copperVein: ResourceNodeDef = {
  id: "node.copper_vein" as ResourceNodeId,
  name: "Copper Vein",
  skill: miningSkill.id,
  swingTicks: 10,
  xpPerSwing: 4,
  drops: [{ itemId: copperOre.id, chance: 1, minQty: 1, maxQty: 1 }],
};

// ---------- Stages ----------

export const forestLv1: StageDef = {
  id: "stage.forest.lv1" as StageId,
  name: "Sunny Forest",
  mode: "solo",
  monsters: [slime.id],
  waveSize: 1,
  waveIntervalTicks: 20,
};

/** A mining-only stage. One copper vein spawns at enter. */
export const copperMine: StageDef = {
  id: "stage.mine.copper" as StageId,
  name: "Copper Mine",
  mode: "solo",
  resourceNodes: [copperVein.id],
};

// ---------- Default DB ----------

export function buildDefaultContent(): ContentDb {
  return {
    ...emptyContentDb(),
    attributes: attrDefs,
    effects: { [strikeEffect.id]: strikeEffect },
    abilities: { [basicAttack.id]: basicAttack },
    monsters: { [slime.id]: slime },
    stages: {
      [forestLv1.id]: forestLv1,
      [copperMine.id]: copperMine,
    },
    items: { [copperOre.id]: copperOre },
    skills: { [miningSkill.id]: miningSkill },
    resourceNodes: { [copperVein.id]: copperVein },
  };
}
