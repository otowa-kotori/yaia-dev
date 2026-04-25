// Default MVP content bundle. Plain-data, kept deliberately minimal.
// Grow this file freely — it's the primary file designers will edit.

import { ATTR } from "../core/entity/attribute";
import type {
  TalentDef,
  TalentId,
  AttrDef,
  ContentDb,
  EffectDef,
  EffectId,
  CombatZoneDef,
  CombatZoneId,
  DungeonDef,
  DungeonId,
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
import type { FormulaRef } from "../core/infra/formula";
import { DEFAULT_CHAR_STACK_LIMIT } from "../core/inventory";
import { monsterBasicAttack, monsterMagicAttack } from "./behaviors/talents/monster";
import { knightPowerStrike, knightFortitude, knightRetaliation, knightRage, knightGuard, knightWarcry } from "./behaviors/talents/knight";
import { knightFortitudeEffect, knightRetaliationEffect, knightRageEffect, knightGuardEffect, knightWarcryEffect } from "./behaviors/effects/knight";
// ---------- Currency IDs ----------

/** Gold — primary combat currency, earned by killing monsters. */
export const CURRENCY_GOLD = "currency.gold";

// ---------- Attributes ----------
//
// 属性分层（完整说明见 docs/design/plan-combat-damage-and-growth.md §1）：
//   一级属性: STR / DEX / INT
//   聚合层:   PHYS_POTENCY / MAG_POTENCY（DynamicModifierProvider 汇聚一级属性）
//   面板层:   PATK / MATK（computeBase 派生，依赖武器值 + 聚合层）
//   防御层:   PDEF（装备 flat）/ MRES（百分比减伤 0–0.8）
//   武器层:   WEAPON_ATK / WEAPON_MATK（装备 flat，赤手默认 1 / 0）
//
// k=0.3 是 sqrt 缩放系数，决定主属性对面板攻击力的放大幅度。
// 全部设计验证见 docs/design/combat-formula.md。

const K_SCALING = 0.3;

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
  [ATTR.STR]: { id: ATTR.STR, name: "力量", defaultBase: 5, integer: true },
  [ATTR.DEX]: { id: ATTR.DEX, name: "敏捷", defaultBase: 5, integer: true },
  [ATTR.INT]: { id: ATTR.INT, name: "智力", defaultBase: 5, integer: true },
  [ATTR.SPEED]: {
    id: ATTR.SPEED,
    name: "速度",
    defaultBase: 40,
    integer: true,
    clampMin: 1,
  },
  // 武器基础值（装备 flat 叠加）
  [ATTR.WEAPON_ATK]: {
    id: ATTR.WEAPON_ATK,
    name: "武器攻击",
    defaultBase: 4,   // 赤手 = 4（空拳基础力道）
    integer: true,
    clampMin: 0,
  },
  [ATTR.WEAPON_MATK]: {
    id: ATTR.WEAPON_MATK,
    name: "武器法攻",
    defaultBase: 0,   // 赤手无法攻 = 0；法师/圣女在 HeroConfig.baseAttrs 里置 1
    integer: true,
    clampMin: 0,
  },
  // 聚合层：由 DynamicModifierProvider 汇聚一级属性，defaultBase = 0
  [ATTR.PHYS_POTENCY]: {
    id: ATTR.PHYS_POTENCY,
    name: "物理潜力",
    defaultBase: 0,
    clampMin: 0,
  },
  [ATTR.MAG_POTENCY]: {
    id: ATTR.MAG_POTENCY,
    name: "魔法潜力",
    defaultBase: 0,
    clampMin: 0,
  },
  // 面板攻击力（computeBase 派生）
  // PATK = WEAPON_ATK × (1 + K × √PHYS_POTENCY)
  [ATTR.PATK]: {
    id: ATTR.PATK,
    name: "物理攻击力",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
    computeBase: (get) =>
      get(ATTR.WEAPON_ATK) * (1 + K_SCALING * Math.sqrt(get(ATTR.PHYS_POTENCY))),
    dependsOn: [ATTR.WEAPON_ATK, ATTR.PHYS_POTENCY],
  },
  // MATK = WEAPON_MATK × (1 + K × √MAG_POTENCY)
  [ATTR.MATK]: {
    id: ATTR.MATK,
    name: "魔法攻击力",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
    computeBase: (get) =>
      get(ATTR.WEAPON_MATK) * (1 + K_SCALING * Math.sqrt(get(ATTR.MAG_POTENCY))),
    dependsOn: [ATTR.WEAPON_MATK, ATTR.MAG_POTENCY],
  },
  // 防御
  [ATTR.PDEF]: {
    id: ATTR.PDEF,
    name: "物理防御",
    defaultBase: 0,
    integer: true,
    clampMin: 0,
  },
  [ATTR.MRES]: {
    id: ATTR.MRES,
    name: "魔法抗性",
    defaultBase: 0,
    clampMin: 0,
    clampMax: 0.8,  // 百分比减伤上限 80%
  },
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
  [ATTR.INVENTORY_STACK_LIMIT]: {
    id: ATTR.INVENTORY_STACK_LIMIT,
    name: "背包堆叠上限",
    defaultBase: DEFAULT_CHAR_STACK_LIMIT,
    integer: true,
    clampMin: 1,
  },
  [ATTR.AGGRO_WEIGHT]: {
    id: ATTR.AGGRO_WEIGHT,
    name: "仇恨权重",
    defaultBase: 1.0,
    clampMin: 0.1,
  },
};

// ---------- Formulas ----------

const defaultProgressionXpParams = {
  a: 8,
  p: 1.8,
  c: 8,
  base: 1.25,
  cap: 0.18,
  d: 0.22,
  e: 80,
  offset: 8,
};

/** Character XP curve from docs/design/progression.md. */
export const defaultCharXpCurve: FormulaRef = {
  kind: "char_xp_curve_v1",
  ...defaultProgressionXpParams,
};


// ---------- Effects ----------

export const strikeEffect: EffectDef = {
  id: "effect.combat.strike" as EffectId,
  kind: "instant",
  magnitudeMode: "damage",
  // ratio-power 破甲方案，详见 docs/design/combat-formula.md §2
  formula: { kind: "phys_damage_v1" },
};

/** 魔法基础攻击——法师/圣女平A使用。读 MATK，绕过 PDEF。 */
export const magicStrikeEffect: EffectDef = {
  id: "effect.combat.magic_strike" as EffectId,
  kind: "instant",
  magnitudeMode: "damage",
  formula: { kind: "magic_damage_v1" },
};

// ---------- Talents ----------

export const basicAttackTalent: TalentDef = {
  id: "talent.basic.attack" as TalentId,
  name: "攻击",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    mpCost: 0,
    cooldownActions: 0,
    energyCost: 1000,
    targetKind: "single_enemy" as const,
  }),
  effects: [strikeEffect.id],
};

/** 魔法基础攻击——法师/圣女平A使用。 */
export const magicBasicAttackTalent: TalentDef = {
  id: "talent.basic.magic_attack" as TalentId,
  name: "魔法攻击",
  type: "active",
  maxLevel: 1,
  tpCost: 0,
  getActiveParams: () => ({
    mpCost: 0,
    cooldownActions: 0,
    energyCost: 1000,
    targetKind: "single_enemy" as const,
  }),
  effects: [magicStrikeEffect.id],
};

// ---------- Monsters ----------

export const slime: MonsterDef = {
  id: "monster.slime" as MonsterId,
  name: "史莱姆",
  level: 1,
  physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  baseAttrs: {
    [ATTR.MAX_HP]: 30,
    [ATTR.WEAPON_ATK]: 4,  // 原 ATK
    [ATTR.PDEF]: 1,         // 原 DEF
    [ATTR.SPEED]: 12,       // very slow — acts roughly every 84 ticks (8.4 s)
  },
  talents: [basicAttackTalent.id],
  drops: [],
  xpReward: 10,
  currencyReward: { [CURRENCY_GOLD]: 5 },
};

export const goblin: MonsterDef = {
  id: "monster.goblin" as MonsterId,
  name: "哥布林",
  level: 1,
  physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  baseAttrs: {
    [ATTR.MAX_HP]: 24,
    [ATTR.WEAPON_ATK]: 6,  // 原 ATK
    [ATTR.PDEF]: 0,
    [ATTR.SPEED]: 32,       // medium — acts roughly every 32 ticks (3.2 s)
  },
  talents: [basicAttackTalent.id],
  drops: [],
  xpReward: 14,
  currencyReward: { [CURRENCY_GOLD]: 7 },
};

/** 洞穴蝙蝠 — 高速低耐。ATB 下行动极快，但脆皮。 */
export const caveBat: MonsterDef = {
  id: "monster.cave_bat" as MonsterId,
  name: "洞穴蝙蝠",
  level: 2,
  physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  baseAttrs: {
    [ATTR.MAX_HP]: 16,
    [ATTR.WEAPON_ATK]: 5,  // 原 ATK
    [ATTR.PDEF]: 0,
    [ATTR.SPEED]: 72,       // nearly 2x player speed — acts roughly every 14 ticks (1.4 s)
  },
  talents: [basicAttackTalent.id],
  drops: [],
  xpReward: 12,
  currencyReward: { [CURRENCY_GOLD]: 6 },
};

/** 训练木人 — 极高血量、极低攻击力，用于测试技能效果。 */
export const trainingDummy: MonsterDef = {
  id: "monster.training_dummy" as MonsterId,
  name: "训练木人",
  level: 1,
  physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  baseAttrs: {
    [ATTR.MAX_HP]: 99999,
    [ATTR.WEAPON_ATK]: 1,
    [ATTR.PDEF]: 0,
    [ATTR.SPEED]: 30,
  },
  talents: [basicAttackTalent.id],
  drops: [],
  xpReward: 1,
  currencyReward: { [CURRENCY_GOLD]: 0 },
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
    { stat: ATTR.WEAPON_ATK, op: "flat", value: 2, sourceId: "item.weapon.training_sword" },
  ],
  tags: ["weapon", "starter"],
};

export const trainingBow: ItemDef = {
  id: "item.weapon.training_bow" as ItemId,
  name: "训练短弓",
  description: "简陋的练习短弓，轻巧但威力有限，游侠的入门装备。",
  stackable: false,
  slot: "weapon",
  modifiers: [
    { stat: ATTR.WEAPON_ATK, op: "flat", value: 2, sourceId: "item.weapon.training_bow" },
  ],
  tags: ["weapon", "starter"],
};

export const trainingStaff: ItemDef = {
  id: "item.weapon.training_staff" as ItemId,
  name: "训练法杖",
  description: "新手魔法师的启蒙法杖，导魔效率低，但聊胜于无。",
  stackable: false,
  slot: "weapon",
  modifiers: [
    { stat: ATTR.WEAPON_MATK, op: "flat", value: 2, sourceId: "item.weapon.training_staff" },
  ],
  tags: ["weapon", "starter"],
};

export const trainingScepter: ItemDef = {
  id: "item.weapon.training_scepter" as ItemId,
  name: "见习权杖",
  description: "圣女见习时持用的权杖，附有轻微的神圣回路加持。",
  stackable: false,
  slot: "weapon",
  modifiers: [
    { stat: ATTR.WEAPON_MATK, op: "flat", value: 2,  sourceId: "item.weapon.training_scepter" },
    { stat: ATTR.MAX_MP,      op: "flat", value: 10, sourceId: "item.weapon.training_scepter" },
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
    { stat: ATTR.WEAPON_ATK, op: "flat", value: 8, sourceId: "item.weapon.copper_sword" },
  ],
  tags: ["weapon", "crafted"],
};

// ---------- Skills ----------


/** Skill XP curve currently mirrors the character curve but keeps its own
 *  formula kind so tuning can diverge later without touching character saves. */
export const defaultSkillXpCurve: FormulaRef = {
  kind: "skill_xp_curve_v1",
  ...defaultProgressionXpParams,
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

// ---------- CombatZones ----------

/** Normal difficulty: single slime per wave. Suitable for beginners. */
export const slimeNormal: CombatZoneDef = {
  id: "combatzone.forest.slime_normal" as CombatZoneId,
  name: "史莱姆小径（普通）",
  waveSelection: "random",
  waveSearchTicks: 20,
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
export const slimeHard: CombatZoneDef = {
  id: "combatzone.forest.slime_hard" as CombatZoneId,
  name: "史莱姆巢穴（困难）",
  waveSelection: "random",
  waveSearchTicks: 20,
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

/** Copper mine combat zone — bat/goblin mix, showcases ATB speed diversity. */
export const copperMineCombat: CombatZoneDef = {
  id: "combatzone.mine.copper_monsters" as CombatZoneId,
  name: "矿洞深处（战斗）",
  waveSelection: "random",
  waveSearchTicks: 20,
  recoverBelowHpFactor: 0.5,
  waves: [
    {
      id: "wave.mine.bat_pair",
      name: "蝙蝠群",
      monsters: [caveBat.id, caveBat.id],
      rewards: {
        drops: [
          { itemId: copperOre.id, chance: 0.5, minQty: 1, maxQty: 1 },
        ],
        currencies: { [CURRENCY_GOLD]: 3 },
      },
    },
    {
      id: "wave.mine.goblin_bat",
      name: "哥布林与蝙蝠",
      monsters: [goblin.id, caveBat.id],
      rewards: {
        drops: [
          { itemId: copperOre.id, chance: 0.5, minQty: 1, maxQty: 1 },
        ],
        currencies: { [CURRENCY_GOLD]: 4 },
      },
    },
  ],
};

/** 训练场 — 单个训练木人，用于测试技能效果和数值验证。 */
export const trainingGroundCombat: CombatZoneDef = {
  id: "combatzone.training.dummy" as CombatZoneId,
  name: "训练场",
  waveSelection: "random",
  waveSearchTicks: 5,
  recoverBelowHpFactor: 0.3,
  waves: [
    {
      id: "wave.training.dummy",
      name: "训练木人",
      monsters: [trainingDummy.id],
    },
  ],
};

// ---------- Dungeons ----------

/** 史莱姆洞窟——三波固定顺序副本，适合两人组队。
 *  第一波：落单史莱姆试探。
 *  第二波：史莱姆群冲锋。
 *  第三波：哥布林指挥官 + 史莱姆护卫。
 *  通关额外奖励 10 金币。 */
export const slimeCaveDungeon: DungeonDef = {
  id: "dungeon.forest.slime_cave" as DungeonId,
  name: "史莱姆洞窟",
  recoverBelowHpFactor: 0.5,
  waveTransitionTicks: 10,
  minPartySize: 1,
  maxPartySize: 2,
  waves: [
    {
      id: "dungeon.slime_cave.wave0",
      name: "洞口哨兵",
      monsters: [slime.id],
      rewards: {
        drops: [
          { itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 1 },
        ],
        currencies: { [CURRENCY_GOLD]: 2 },
      },
    },
    {
      id: "dungeon.slime_cave.wave1",
      name: "史莱姆群涌",
      monsters: [slime.id, slime.id, slime.id],
      rewards: {
        drops: [
          { itemId: slimeGel.id, chance: 1, minQty: 2, maxQty: 3 },
        ],
        currencies: { [CURRENCY_GOLD]: 4 },
      },
    },
    {
      id: "dungeon.slime_cave.wave2",
      name: "哥布林指挥官",
      monsters: [goblin.id, slime.id, slime.id],
      rewards: {
        drops: [
          { itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 2 },
        ],
        currencies: { [CURRENCY_GOLD]: 6 },
      },
    },
  ],
  completionRewards: {
    currencies: { [CURRENCY_GOLD]: 10 },
  },
};

// ---------- Locations ----------

export const forestLocation: LocationDef = {
  id: "location.forest" as LocationId,
  name: "阳光森林",
  entries: [
    { kind: "combat", combatZoneId: slimeNormal.id, label: "史莱姆小径（普通）" },
    { kind: "combat", combatZoneId: slimeHard.id, label: "史莱姆巢穴（困难）" },
    { kind: "dungeon", dungeonId: slimeCaveDungeon.id, label: "史莱姆洞窟（副本）" },
  ],
};

export const copperMineLocation: LocationDef = {
  id: "location.mine.copper" as LocationId,
  name: "铜矿洞",
  entries: [
    { kind: "combat", combatZoneId: copperMineCombat.id, label: "矿洞深处（战斗）" },
    { kind: "gather", resourceNodes: [copperVein.id], label: "铜矿脉" },
  ],
};

/** 训练场 — 玩家可在此测试技能效果。 */
export const trainingGroundLocation: LocationDef = {
  id: "location.training" as LocationId,
  name: "训练场",
  entries: [
    { kind: "combat", combatZoneId: trainingGroundCombat.id, label: "训练木人" },
  ],
};

// ---------- Global Upgrades ----------
//
// Purchased via WorldRecord. Cost scales using exp_curve_v1 so the same
// formula evaluator handles both character XP and upgrade pricing.
//
// 战士训练: WEAPON_ATK flat +2，10 级上限
//   Cost: 50 / 80 / 128 / 205 / 328 / 524 / 839 / 1342 / 2147 / 3436
// 护甲强化: PDEF flat +1，10 级上限
//   Cost: 40 / 60 / 90 / 135 / 202 / 304 / 455 / 683 / 1024 / 1536

export const atkUpgrade: UpgradeDef = {
  id: "upgrade.combat.atk",
  name: "战士训练",
  description: "永久提升所有角色武器攻击力 +2",
  maxLevel: 10,
  modifierPerLevel: [
    { stat: ATTR.WEAPON_ATK, op: "flat", value: 2, sourceId: "world.upgrade.combat.atk" },
  ],
  costCurrency: CURRENCY_GOLD,
  costScaling: { kind: "exp_curve_v1", base: 50, growth: 1.6 },
};

export const defUpgrade: UpgradeDef = {
  id: "upgrade.combat.def",
  name: "护甲强化",
  description: "永久提升所有角色物理防御 +1",
  maxLevel: 10,
  modifierPerLevel: [
    { stat: ATTR.PDEF, op: "flat", value: 1, sourceId: "world.upgrade.combat.def" },
  ],
  costCurrency: CURRENCY_GOLD,
  costScaling: { kind: "exp_curve_v1", base: 40, growth: 1.5 },
};

// ---------- Default DB ----------

// 四职业初始属性与成长配置（详见 docs/design/plan-combat-damage-and-growth.md §3-4）
//
// physScaling: 决定哪个一级属性驱动 PHYS_POTENCY → PATK
//   骑士/游侠用各自主属性；法师/圣女 physScaling = STR（低值）→ 赤手 PATK 极低但非零
// growth: 每级增量（float 合法，integer: true AttrDef 会在 getAttr 时 floor）
// baseAttrs: Lv1 初始属性，覆盖 AttrDef.defaultBase

export function buildDefaultContent(): ContentDb {
  return {
    ...emptyContentDb(),
    attributes: attrDefs,
    effects: {
      [strikeEffect.id]: strikeEffect,
      [magicStrikeEffect.id]: magicStrikeEffect,
      [knightFortitudeEffect.id]: knightFortitudeEffect,
      [knightRetaliationEffect.id]: knightRetaliationEffect,
      [knightRageEffect.id]: knightRageEffect,
      [knightGuardEffect.id]: knightGuardEffect,
      [knightWarcryEffect.id]: knightWarcryEffect,
    },
    talents: {
      [basicAttackTalent.id]: basicAttackTalent,
      [magicBasicAttackTalent.id]: magicBasicAttackTalent,
      [monsterBasicAttack.id]: monsterBasicAttack,
      [monsterMagicAttack.id]: monsterMagicAttack,
      [knightPowerStrike.id]: knightPowerStrike,
      [knightFortitude.id]: knightFortitude,
      [knightRetaliation.id]: knightRetaliation,
      [knightRage.id]: knightRage,
      [knightGuard.id]: knightGuard,
      [knightWarcry.id]: knightWarcry,
    },
    monsters: {
      [slime.id]: slime,
      [goblin.id]: goblin,
      [caveBat.id]: caveBat,
      [trainingDummy.id]: trainingDummy,
    },
    locations: {
      [forestLocation.id]: forestLocation,
      [copperMineLocation.id]: copperMineLocation,
      [trainingGroundLocation.id]: trainingGroundLocation,
    },
    combatZones: {
      [slimeNormal.id]: slimeNormal,
      [slimeHard.id]: slimeHard,
      [copperMineCombat.id]: copperMineCombat,
      [trainingGroundCombat.id]: trainingGroundCombat,
    },
    dungeons: {
      [slimeCaveDungeon.id]: slimeCaveDungeon,
    },
    items: {
      [copperOre.id]: copperOre,
      [slimeGel.id]: slimeGel,
      [trainingSword.id]: trainingSword,
      [trainingBow.id]: trainingBow,
      [trainingStaff.id]: trainingStaff,
      [trainingScepter.id]: trainingScepter,
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
        // ── 骑士 ──────────────────────────────────────────
        {
          id: "hero.knight",
          name: "骑士",
          xpCurve: defaultCharXpCurve,
          knownTalents: [basicAttackTalent.id],
          availableTalents: [knightPowerStrike.id, knightFortitude.id, knightRetaliation.id, knightRage.id, knightGuard.id, knightWarcry.id],
          startingItems: [{ itemId: trainingSword.id, qty: 1 }],
          baseAttrs: {
            [ATTR.MAX_HP]: 180,
            [ATTR.MAX_MP]: 30,
            [ATTR.STR]: 10,
            [ATTR.DEX]: 5,
            [ATTR.INT]: 3,
            [ATTR.SPEED]: 40,
          },
          growth: {
            [ATTR.MAX_HP]: 20,
            [ATTR.MAX_MP]: 2,
            [ATTR.STR]: 2.5,
            [ATTR.DEX]: 1,
          },
          physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
          magScaling:  [{ attr: ATTR.INT, ratio: 1.0 }],
          intentConfig: [
            { talentId: knightWarcry.id as string, targetPolicy: "self", conditions: ["off_cooldown", "has_mp"] },
            { talentId: knightPowerStrike.id as string, conditions: ["off_cooldown", "has_mp"] },
          ],
        },
        // ── 游侠 ──────────────────────────────────────────
        {
          id: "hero.ranger",
          name: "游侠",
          xpCurve: defaultCharXpCurve,
          knownTalents: [basicAttackTalent.id],
          startingItems: [{ itemId: trainingBow.id, qty: 1 }],
          baseAttrs: {
            [ATTR.MAX_HP]: 120,
            [ATTR.MAX_MP]: 40,
            [ATTR.STR]: 6,
            [ATTR.DEX]: 10,
            [ATTR.INT]: 3,
            [ATTR.SPEED]: 50,
          },
          growth: {
            [ATTR.MAX_HP]: 14,
            [ATTR.MAX_MP]: 3,
            [ATTR.STR]: 1,
            [ATTR.DEX]: 2.5,
            [ATTR.INT]: 0,
          },
          physScaling: [{ attr: ATTR.DEX, ratio: 1.0 }],
          magScaling:  [{ attr: ATTR.INT, ratio: 1.0 }],
        },
        // ── 法师 ──────────────────────────────────────────
        {
          id: "hero.mage",
          name: "法师",
          xpCurve: defaultCharXpCurve,
          knownTalents: [magicBasicAttackTalent.id],
          startingItems: [{ itemId: trainingStaff.id, qty: 1 }],
          baseAttrs: {
            [ATTR.MAX_HP]: 90,
            [ATTR.MAX_MP]: 80,
            [ATTR.STR]: 3,
            [ATTR.DEX]: 4,
            [ATTR.INT]: 10,
            [ATTR.SPEED]: 40,
            [ATTR.WEAPON_MATK]: 1,  // 赤手有基础法攻
          },
          growth: {
            [ATTR.MAX_HP]: 10,
            [ATTR.MAX_MP]: 8,
            [ATTR.DEX]: 0.5,
            [ATTR.INT]: 2.5,
          },
          // physScaling = STR：法师 STR 低且无成长 → PATK 极低（赤手约 1.5）
          physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
          magScaling:  [{ attr: ATTR.INT, ratio: 1.0 }],
        },
        // ── 圣女 ──────────────────────────────────────────
        {
          id: "hero.cleric",
          name: "圣女",
          xpCurve: defaultCharXpCurve,
          knownTalents: [magicBasicAttackTalent.id],
          startingItems: [{ itemId: trainingScepter.id, qty: 1 }],
          baseAttrs: {
            [ATTR.MAX_HP]: 110,
            [ATTR.MAX_MP]: 60,
            [ATTR.STR]: 3,
            [ATTR.DEX]: 4,
            [ATTR.INT]: 8,
            [ATTR.SPEED]: 40,
            [ATTR.WEAPON_MATK]: 1,  // 赤手有基础法攻
            [ATTR.MRES]: 0.20,      // 初始 20% 魔法抗性
          },
          growth: {
            [ATTR.MAX_HP]: 12,
            [ATTR.MAX_MP]: 6,
            [ATTR.DEX]: 0.5,
            [ATTR.INT]: 2,
          },
          // physScaling = STR：同法师，PATK 极低
          physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
          magScaling:  [{ attr: ATTR.INT, ratio: 1.0 }],
        },
      ],

      initialLocationId: forestLocation.id,
    },
  };
}
