import { ATTR } from "../../../core/entity/attribute";
import type { MonsterDef, MonsterId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";
import { CURRENCY_GOLD } from "../currencies";
import {
  beastHide,
  boneDust,
  bossCore,
  carapace,
  shadowCore,
  slimeGel,
  twilightEssence,
  wolfKingFang,
} from "../items";

// 早期怪物：人怪同模，属性 = baseAttrs + growth × (level - 1)。
// 标准怪物不覆写任何属性（全部继承 monster.template.base 的基线值）。
// 特化怪物只覆写偏离标准的维度。
export const earlyGameMonsterDrafts = {
  "monster.green_slime": {
    id: "monster.green_slime" as MonsterId,
    extends: "monster.template.base",
    name: "绿史莱姆",
    level: 1,
    // 教学怪：比标准弱
    baseAttrs: {
      [ATTR.MAX_HP]: 30,
      [ATTR.STR]: 5,
      [ATTR.DEX]: 5,
      [ATTR.CON]: 5,
      [ATTR.WEAPON_ATK]: 2,
    },
    growth: {
      [ATTR.MAX_HP]: 10,
      [ATTR.STR]: 2,
      [ATTR.DEX]: 2,
      [ATTR.CON]: 2,
      [ATTR.WEAPON_ATK]: 1,
    },
    rewards: {
      drops: [{ itemId: slimeGel.id, chance: 0.2, minQty: 1, maxQty: 1 }],
      charXp: 1,
      currencies: { [CURRENCY_GOLD]: 1 },
    },
  },
  "monster.slime": {
    id: "monster.slime" as MonsterId,
    extends: "monster.template.base",
    name: "史莱姆",
    level: 3,
    // 标准怪：不覆写属性，全走基线
    rewards: {
      drops: [{ itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 1 }],
      charXp: 5,
      currencies: { [CURRENCY_GOLD]: 2 },
    },
  },
  "monster.wild_boar": {
    id: "monster.wild_boar" as MonsterId,
    extends: "monster.template.base",
    name: "野猪",
    level: 5,
    // 攻击高
    baseAttrs: { [ATTR.STR]: 20, [ATTR.WEAPON_ATK]: 8 },
    growth: { [ATTR.STR]: 7 },
    rewards: {
      drops: [{ itemId: beastHide.id, chance: 1, minQty: 1, maxQty: 1 }],
      charXp: 10,
      currencies: { [CURRENCY_GOLD]: 3 },
    },
  },
  "monster.horned_rabbit": {
    id: "monster.horned_rabbit" as MonsterId,
    extends: "monster.template.base",
    name: "角兔",
    level: 7,
    // 速度快、DEX 高，HP 偏低
    baseAttrs: { [ATTR.SPEED]: 55, [ATTR.DEX]: 20, [ATTR.MAX_HP]: 50 },
    growth: { [ATTR.DEX]: 6 },
    rewards: {
      drops: [{ itemId: beastHide.id, chance: 1, minQty: 1, maxQty: 1 }],
      charXp: 10,
      currencies: { [CURRENCY_GOLD]: 3 },
    },
  },
  "monster.big_slime": {
    id: "monster.big_slime" as MonsterId,
    extends: "monster.template.base",
    name: "大史莱姆",
    level: 8,
    // 血量高（CON 高 + 额外 HP），攻击略强
    baseAttrs: { [ATTR.CON]: 25, [ATTR.MAX_HP]: 120, [ATTR.STR]: 18 },
    growth: { [ATTR.CON]: 6, [ATTR.MAX_HP]: 35 },
    rewards: {
      drops: [{ itemId: slimeGel.id, chance: 1, minQty: 2, maxQty: 3 }],
      charXp: 18,
      currencies: { [CURRENCY_GOLD]: 4 },
    },
  },
  "monster.poison_mushroom": {
    id: "monster.poison_mushroom" as MonsterId,
    extends: "monster.template.base",
    name: "毒蘑菇",
    level: 9,
    // 标准偏弱攻击，特色靠 DoT（未来实现）
    rewards: {
      charXp: 32,
      currencies: { [CURRENCY_GOLD]: 5 },
    },
  },
  "monster.dusk_wolf": {
    id: "monster.dusk_wolf" as MonsterId,
    extends: "monster.template.base",
    name: "暮色狼",
    level: 12,
    // 标准怪，稍偏攻击
    baseAttrs: { [ATTR.STR]: 18, [ATTR.SPEED]: 45 },
    growth: { [ATTR.STR]: 6 },
    rewards: {
      drops: [{ itemId: twilightEssence.id, chance: 1, minQty: 1, maxQty: 1 }],
      charXp: 42,
      currencies: { [CURRENCY_GOLD]: 6 },
    },
  },
  "monster.skeleton_soldier": {
    id: "monster.skeleton_soldier" as MonsterId,
    extends: "monster.template.base",
    name: "骸骨兵",
    level: 15,
    // 高甲特化
    baseAttrs: { [ATTR.PDEF]: 30, [ATTR.MRES]: 0.05 },
    growth: { [ATTR.PDEF]: 5 },
    rewards: {
      drops: [{ itemId: boneDust.id, chance: 1, minQty: 1, maxQty: 1 }],
      charXp: 55,
      currencies: { [CURRENCY_GOLD]: 7 },
    },
  },
  "monster.dire_wolf": {
    id: "monster.dire_wolf" as MonsterId,
    extends: "monster.template.base",
    name: "巨狼",
    level: 16,
    // 副本精英：全面偏强
    baseAttrs: { [ATTR.STR]: 22, [ATTR.CON]: 20, [ATTR.MAX_HP]: 100, [ATTR.SPEED]: 45 },
    growth: { [ATTR.STR]: 7, [ATTR.CON]: 5 },
    rewards: {
      drops: [{ itemId: wolfKingFang.id, chance: 0.5, minQty: 1, maxQty: 1 }],
      charXp: 64,
      currencies: { [CURRENCY_GOLD]: 9 },
    },
  },
  "monster.cave_bat": {
    id: "monster.cave_bat" as MonsterId,
    extends: "monster.template.base",
    name: "洞穴蝙蝠",
    level: 19,
    // 弱但快、DEX 高（多只群体压制）
    baseAttrs: { [ATTR.MAX_HP]: 50, [ATTR.DEX]: 22, [ATTR.SPEED]: 50 },
    growth: { [ATTR.DEX]: 6 },
    rewards: {
      drops: [{ itemId: carapace.id, chance: 0.5, minQty: 1, maxQty: 1 }],
      charXp: 68,
      currencies: { [CURRENCY_GOLD]: 8 },
    },
  },
  "monster.shadow_fiend": {
    id: "monster.shadow_fiend" as MonsterId,
    extends: "monster.template.base",
    name: "暗影魔",
    level: 22,
    // 高魔抗 + 高攻
    baseAttrs: { [ATTR.MRES]: 0.55, [ATTR.STR]: 22, [ATTR.WEAPON_ATK]: 10 },
    growth: { [ATTR.STR]: 7 },
    rewards: {
      drops: [{ itemId: shadowCore.id, chance: 0.5, minQty: 1, maxQty: 1 }],
      charXp: 78,
      currencies: { [CURRENCY_GOLD]: 11 },
    },
  },
  "monster.ore_crab": {
    id: "monster.ore_crab" as MonsterId,
    extends: "monster.template.base",
    name: "矿石蟹",
    level: 24,
    // 极高甲 + 肉 + 慢
    baseAttrs: {
      [ATTR.PDEF]: 40,
      [ATTR.CON]: 25,
      [ATTR.MAX_HP]: 120,
      [ATTR.DEX]: 8,
      [ATTR.SPEED]: 35,
      [ATTR.MRES]: 0.15,
    },
    growth: { [ATTR.PDEF]: 6, [ATTR.CON]: 6 },
    rewards: {
      drops: [{ itemId: carapace.id, chance: 1, minQty: 1, maxQty: 1 }],
      charXp: 85,
      currencies: { [CURRENCY_GOLD]: 12 },
    },
  },
  "monster.blackfang_alpha": {
    id: "monster.blackfang_alpha" as MonsterId,
    extends: "monster.template.base",
    name: "黑牙兽王",
    level: 27,
    // Boss：全面强化
    baseAttrs: {
      [ATTR.MAX_HP]: 200,
      [ATTR.STR]: 25,
      [ATTR.DEX]: 20,
      [ATTR.CON]: 30,
      [ATTR.WEAPON_ATK]: 12,
      [ATTR.PDEF]: 15,
      [ATTR.MRES]: 0.2,
      [ATTR.SPEED]: 45,
    },
    growth: {
      [ATTR.MAX_HP]: 40,
      [ATTR.STR]: 8,
      [ATTR.CON]: 6,
      [ATTR.WEAPON_ATK]: 3,
      [ATTR.PDEF]: 3,
    },
    rewards: {
      drops: [{ itemId: bossCore.id, chance: 1, minQty: 1, maxQty: 1 }],
      charXp: 120,
      currencies: { [CURRENCY_GOLD]: 20 },
    },
  },
  "monster.training_dummy": {
    id: "monster.training_dummy" as MonsterId,
    extends: "monster.template.base",
    name: "训练木人",
    level: 1,
    baseAttrs: {
      [ATTR.MAX_HP]: 99999,
      [ATTR.STR]: 1,
      [ATTR.DEX]: 1,
      [ATTR.CON]: 1,
      [ATTR.WEAPON_ATK]: 1,
    },
    growth: {},
    rewards: {
      charXp: 1,
      currencies: { [CURRENCY_GOLD]: 0 },
    },
  },
} satisfies Record<string, AuthoringDef<MonsterDef>>;
