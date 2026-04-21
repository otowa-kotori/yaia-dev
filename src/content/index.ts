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
  UpgradeDef,
} from "../core/content";
import { emptyContentDb } from "../core/content";
import type { FormulaRef } from "../core/formula";
import { DEFAULT_CHAR_STACK_LIMIT } from "../core/inventory";

// ---------- Currency IDs ----------

/** Gold — primary combat currency, earned by killing monsters. */
export const CURRENCY_GOLD = "currency.gold";

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
  [ATTR.INVENTORY_STACK_LIMIT]: {
    id: ATTR.INVENTORY_STACK_LIMIT,
    name: "Inventory Stack Limit",
    defaultBase: DEFAULT_CHAR_STACK_LIMIT,
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
  currencyReward: { [CURRENCY_GOLD]: 5 },
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

// ---------- Global Upgrades ----------
//
// Purchased via WorldRecord. Cost scales using exp_curve_v1 so the same
// formula evaluator handles both character XP and upgrade pricing.
//
// ATK upgrade: +2 ATK per level, 10 levels max.
//   Cost: 50 / 80 / 128 / 205 / 328 / 524 / 839 / 1342 / 2147 / 3436
// DEF upgrade: +1 DEF per level, 10 levels max.
//   Cost: 40 / 60 / 90 / 135 / 202 / 304 / 455 / 683 / 1024 / 1536

export const atkUpgrade: UpgradeDef = {
  id: "upgrade.combat.atk",
  name: "战士训练",
  description: "永久提升所有角色攻击力 +2",
  maxLevel: 10,
  modifierPerLevel: [
    { stat: ATTR.ATK, op: "flat", value: 2, sourceId: "world.upgrade.combat.atk" },
  ],
  costCurrency: CURRENCY_GOLD,
  costScaling: { kind: "exp_curve_v1", base: 50, growth: 1.6 },
};

export const defUpgrade: UpgradeDef = {
  id: "upgrade.combat.def",
  name: "护甲强化",
  description: "永久提升所有角色防御力 +1",
  maxLevel: 10,
  modifierPerLevel: [
    { stat: ATTR.DEF, op: "flat", value: 1, sourceId: "world.upgrade.combat.def" },
  ],
  costCurrency: CURRENCY_GOLD,
  costScaling: { kind: "exp_curve_v1", base: 40, growth: 1.5 },
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
    upgrades: {
      [atkUpgrade.id]: atkUpgrade,
      [defUpgrade.id]: defUpgrade,
    },
  };
}
