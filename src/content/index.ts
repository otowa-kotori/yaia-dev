// Default MVP content bundle. Plain-data, kept deliberately minimal.
// Grow this file freely — it's the primary file designers will edit.

import { ATTR } from "../core/attribute";
import type {
  AbilityDef,
  AbilityId,
  AttrDef,
  ContentDb,
  EffectDef,
  EffectId,
  EncounterDef,
  EncounterId,
  ItemDef,
  ItemId,
  LocationDef,
  LocationId,
  MonsterDef,
  MonsterId,
  RecipeDef,
  RecipeId,
  ResourceNodeDef,
  ResourceNodeId,
  SkillDef,
  SkillId,
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
    name: "生命上限",
    defaultBase: 50,
    integer: true,
    clampMin: 0,
  },
  [ATTR.MAX_MP]: {
    id: ATTR.MAX_MP,
    name: "魔力上限",
    defaultBase: 10,
    integer: true,
    clampMin: 0,
  },
  [ATTR.ATK]: {
    id: ATTR.ATK,
    name: "攻击",
    defaultBase: 8,
    integer: true,
    clampMin: 0,
  },
  [ATTR.DEF]: {
    id: ATTR.DEF,
    name: "防御",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.STR]: { id: ATTR.STR, name: "力量", defaultBase: 5, integer: true },
  [ATTR.DEX]: { id: ATTR.DEX, name: "敏捷", defaultBase: 5, integer: true },
  [ATTR.INT]: { id: ATTR.INT, name: "智力", defaultBase: 5, integer: true },
  [ATTR.WIS]: { id: ATTR.WIS, name: "感知", defaultBase: 5, integer: true },
  [ATTR.CRIT_RATE]: {
    id: ATTR.CRIT_RATE,
    name: "暴击率",
    defaultBase: 0,
    clampMin: 0,
    clampMax: 1,
  },
  [ATTR.CRIT_MULT]: {
    id: ATTR.CRIT_MULT,
    name: "暴击倍率",
    defaultBase: 1.5,
    clampMin: 1,
  },
  [ATTR.SPEED]: {
    id: ATTR.SPEED,
    name: "速度",
    defaultBase: 10,
    integer: true,
    clampMin: 1,
  },
  [ATTR.INVENTORY_STACK_LIMIT]: {
    id: ATTR.INVENTORY_STACK_LIMIT,
    name: "背包堆叠上限",
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
  name: "攻击",
  targetKind: "single_enemy",
  effects: [strikeEffect.id],
};

// ---------- Monsters ----------

export const slime: MonsterDef = {
  id: "monster.slime" as MonsterId,
  name: "史莱姆",
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

export const goblin: MonsterDef = {
  id: "monster.goblin" as MonsterId,
  name: "哥布林",
  level: 1,
  baseAttrs: {
    [ATTR.MAX_HP]: 24,
    [ATTR.ATK]: 6,
    [ATTR.DEF]: 0,
    [ATTR.SPEED]: 7,
  },
  abilities: [basicAttack.id],
  drops: [],
  xpReward: 14,
  currencyReward: { [CURRENCY_GOLD]: 7 },
};

// ---------- Items ----------

export const copperOre: ItemDef = {
  id: "item.ore.copper" as ItemId,
  name: "铜矿石",
  description: "刚挖出来的粗铜矿石，是最基础的金属材料之一。",
  stackable: true,
  tags: ["ore"],
};


export const slimeGel: ItemDef = {
  id: "item.monster.slime_gel" as ItemId,
  name: "史莱姆胶",
  description: "一团黏糊糊的史莱姆胶，常用来当作低阶黏结材料。",
  stackable: true,
  tags: ["monster_drop"],
};

export const trainingSword: ItemDef = {
  id: "item.weapon.training_sword" as ItemId,
  name: "训练木剑",
  description: "给新手练手用的木制短剑，虽然朴素，但总比空手强。",
  stackable: false,
  slot: "weapon",
  modifiers: [
    { stat: ATTR.ATK, op: "flat", value: 2, sourceId: "item.weapon.training_sword" },
  ],
  tags: ["weapon", "starter"],
};

export const copperSword: ItemDef = {
  id: "item.weapon.copper_sword" as ItemId,
  name: "铜剑",
  description: "用铜矿和史莱姆胶拼成的初阶短剑，刃口粗糙但已经足够实战。",
  stackable: false,
  slot: "weapon",
  modifiers: [
    { stat: ATTR.ATK, op: "flat", value: 5, sourceId: "item.weapon.copper_sword" },
  ],
  tags: ["weapon", "crafted"],
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
  name: "采矿",
  xpCurve: defaultSkillXpCurve,
  maxLevel: 99,
};

export const smithingSkill: SkillDef = {
  id: "skill.smithing" as SkillId,
  name: "锻造",
  xpCurve: defaultSkillXpCurve,
  maxLevel: 99,
};

// ---------- Recipes ----------

export const copperSwordRecipe: RecipeDef = {
  id: "recipe.craft.copper_sword" as RecipeId,
  name: "锻造铜剑",
  skill: smithingSkill.id,
  requiredLevel: 1,
  durationTicks: 10,
  inputs: [
    { itemId: copperOre.id, qty: 3 },
    { itemId: slimeGel.id, qty: 2 },
  ],
  outputs: [{ itemId: copperSword.id, qty: 1 }],
  xpReward: 8,
};

// ---------- Resource Nodes ----------


export const copperVein: ResourceNodeDef = {
  id: "node.copper_vein" as ResourceNodeId,
  name: "铜矿脉",
  skill: miningSkill.id,
  swingTicks: 10,
  xpPerSwing: 4,
  drops: [{ itemId: copperOre.id, chance: 1, minQty: 1, maxQty: 1 }],
};

// ---------- Encounters ----------

/** Normal difficulty: single slime per wave. Suitable for beginners. */
export const slimeNormal: EncounterDef = {
  id: "encounter.forest.slime_normal" as EncounterId,
  name: "史莱姆小径（普通）",
  waveSelection: "random",
  waveIntervalTicks: 20,
  recoverBelowHpFactor: 0.5,
  waves: [
    {
      id: "wave.forest.lone_slime",
      name: "落单史莱姆",
      monsters: [slime.id],
      rewards: {
        drops: [
          { itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 1 },
        ],
        currencies: { [CURRENCY_GOLD]: 1 },
      },
    },
  ],
};

/** Hard difficulty: double slime or mixed pack. Higher rewards. */
export const slimeHard: EncounterDef = {
  id: "encounter.forest.slime_hard" as EncounterId,
  name: "史莱姆巢穴（困难）",
  waveSelection: "random",
  waveIntervalTicks: 20,
  recoverBelowHpFactor: 0.5,
  waves: [
    {
      id: "wave.forest.slime_pack",
      name: "史莱姆群",
      monsters: [slime.id, slime.id],
      rewards: {
        drops: [
          { itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 2 },
        ],
        currencies: { [CURRENCY_GOLD]: 2 },
      },
    },
    {
      id: "wave.forest.goblin_patrol",
      name: "哥布林巡逻队",
      monsters: [slime.id, goblin.id],
      rewards: {
        drops: [
          { itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 1 },
        ],
        currencies: { [CURRENCY_GOLD]: 4 },
      },
    },
  ],
};

// ---------- Locations ----------

export const forestLocation: LocationDef = {
  id: "location.forest" as LocationId,
  name: "阳光森林",
  entries: [
    { kind: "combat", encounterId: slimeNormal.id, label: "史莱姆小径（普通）" },
    { kind: "combat", encounterId: slimeHard.id, label: "史莱姆巢穴（困难）" },
  ],
};

export const copperMineLocation: LocationDef = {
  id: "location.mine.copper" as LocationId,
  name: "铜矿洞",
  entries: [
    { kind: "gather", resourceNodes: [copperVein.id], label: "铜矿脉" },
  ],
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
    monsters: {
      [slime.id]: slime,
      [goblin.id]: goblin,
    },
    locations: {
      [forestLocation.id]: forestLocation,
      [copperMineLocation.id]: copperMineLocation,
    },
    encounters: {
      [slimeNormal.id]: slimeNormal,
      [slimeHard.id]: slimeHard,
    },
    items: {
      [copperOre.id]: copperOre,
      [slimeGel.id]: slimeGel,
      [trainingSword.id]: trainingSword,
      [copperSword.id]: copperSword,
    },
    skills: {
      [miningSkill.id]: miningSkill,
      [smithingSkill.id]: smithingSkill,
    },
    recipes: {
      [copperSwordRecipe.id]: copperSwordRecipe,
    },
    resourceNodes: { [copperVein.id]: copperVein },

    upgrades: {
      [atkUpgrade.id]: atkUpgrade,
      [defUpgrade.id]: defUpgrade,
    },
    starting: {
      heroes: [
        {
          id: "hero.1",
          name: "勇者",
          xpCurve: defaultCharXpCurve,
          knownAbilities: [basicAttack.id],
          startingItems: [{ itemId: trainingSword.id, qty: 1 }],
        },
        {
          id: "hero.2",
          name: "学徒",
          xpCurve: defaultCharXpCurve,
          knownAbilities: [basicAttack.id],
        },
      ],

      initialLocationId: forestLocation.id,
    },
  };
}
