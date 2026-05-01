import { ATTR } from "../../../core/entity/attribute";
import type { MonsterDef, MonsterId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";
import { CURRENCY_GOLD } from "../currencies";

// Phase 0 怪物：四档，单一地点，验证基础战斗平衡。
// 怪物整体战力低于同级玩家：DEX/STR 偏低，保证玩家稳赢。
// 属性 = baseAttrs + growth × (level - 1)。
export const earlyGameMonsterDrafts = {
  "monster.tutorial_slime": {
    id: "monster.tutorial_slime" as MonsterId,
    extends: "monster.template.base",
    name: "绿史莱姆",
    level: 1,
    // 第 1 关教学怪：极弱，2~3 下死。
    baseAttrs: {
      [ATTR.MAX_HP]: 30,
      [ATTR.STR]: 5,
      [ATTR.DEX]: 5,
      [ATTR.INT]: 5,
      [ATTR.CON]: 5,
      [ATTR.WEAPON_ATK]: 2,
    },
    growth: {
      [ATTR.MAX_HP]: 10,
      [ATTR.STR]: 3,
      [ATTR.DEX]: 3,
      [ATTR.INT]: 3,
      [ATTR.CON]: 3,
    },
    rewards: {
      charXp: 3,
      currencies: { [CURRENCY_GOLD]: 1 },
    },
  },
  "monster.slime": {
    id: "monster.slime" as MonsterId,
    extends: "monster.template.base",
    name: "史莱姆",
    level: 2,
    // 第 2 关正常怪：势均力敌，约 30 秒击杀。
    baseAttrs: {
      [ATTR.MAX_HP]: 100,
      [ATTR.STR]: 15,
      [ATTR.DEX]: 16,
      [ATTR.INT]: 10,
      [ATTR.CON]: 12,
      [ATTR.WEAPON_ATK]: 4,
    },
    growth: {
      [ATTR.MAX_HP]: 15,
      [ATTR.STR]: 6,
      [ATTR.DEX]: 6,
      [ATTR.INT]: 5,
      [ATTR.CON]: 5,
    },
    rewards: {
      charXp: 10,
      currencies: { [CURRENCY_GOLD]: 2 },
    },
  },
  "monster.wild_boar": {
    id: "monster.wild_boar" as MonsterId,
    extends: "monster.template.base",
    name: "野猪",
    level: 5,
    // 第 3 关较强怪：有物防，物理角色需要破甲。
    baseAttrs: {
      [ATTR.MAX_HP]: 150,
      [ATTR.STR]: 18,
      [ATTR.DEX]: 20,
      [ATTR.INT]: 10,
      [ATTR.CON]: 16,
      [ATTR.WEAPON_ATK]: 5,
      [ATTR.PDEF]: 5,
      [ATTR.MRES]: 0.1,
    },
    growth: {
      [ATTR.MAX_HP]: 20,
      [ATTR.STR]: 7,
      [ATTR.DEX]: 7,
      [ATTR.INT]: 5,
      [ATTR.CON]: 6,
      [ATTR.PDEF]: 1,
    },
    rewards: {
      charXp: 25,
      currencies: { [CURRENCY_GOLD]: 4 },
    },
  },
  "monster.armored_bear": {
    id: "monster.armored_bear" as MonsterId,
    extends: "monster.template.base",
    name: "铁甲熊",
    level: 8,
    // 第 4 关强怪：高甲高血，物理角色明显被卡。
    baseAttrs: {
      [ATTR.MAX_HP]: 350,
      [ATTR.STR]: 22,
      [ATTR.DEX]: 25,
      [ATTR.INT]: 12,
      [ATTR.CON]: 22,
      [ATTR.WEAPON_ATK]: 7,
      [ATTR.PDEF]: 12,
      [ATTR.MRES]: 0.15,
    },
    growth: {
      [ATTR.MAX_HP]: 30,
      [ATTR.STR]: 8,
      [ATTR.DEX]: 8,
      [ATTR.INT]: 5,
      [ATTR.CON]: 7,
      [ATTR.PDEF]: 2,
    },
    rewards: {
      charXp: 50,
      currencies: { [CURRENCY_GOLD]: 8 },
    },
  },
} satisfies Record<string, AuthoringDef<MonsterDef>>;
