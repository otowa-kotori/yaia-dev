import type { MonsterDef, MonsterId } from "../../../core/content";
import { ATTR } from "../../../core/entity/attribute";
import type { AuthoringDef } from "../../compiler/inheritance";
import { CURRENCY_GOLD } from "../currencies";

// Phase 0：四档关卡怪共用一个 Tier0 模板（monster.template.phase0.t0）。
// 数值锚点默认走 baseline growth×2；此处只写关卡差异（名称 / 等级 / 掉落）。
export const earlyGameMonsterDrafts = {
  "monster.tutorial_slime": {
    id: "monster.tutorial_slime" as MonsterId,
    extends: "monster.template.phase0.t0",
    name: "绿史莱姆",
    level: 1,
    growth: {
      [ATTR.STR]: 2,
      [ATTR.CON]: 2,
    },
    rewards: {
      charXp: 2,
      currencies: { [CURRENCY_GOLD]: 1 },
    },
  },
  "monster.slime": {
    id: "monster.slime" as MonsterId,
    extends: "monster.template.phase0.t0",
    name: "史莱姆",
    level: 2,
    rewards: {
      charXp: 10,
      currencies: { [CURRENCY_GOLD]: 2 },
    },
  },
  "monster.wild_boar": {
    id: "monster.wild_boar" as MonsterId,
    extends: "monster.template.phase0.t0",
    name: "野猪",
    level: 5,
    growth: {
      [ATTR.STR]: 10,
      [ATTR.PDEF]: 0.5,
    },
    rewards: {
      charXp: 25,
      currencies: { [CURRENCY_GOLD]: 4 },
    },
  },
  "monster.armored_bear": {
    id: "monster.armored_bear" as MonsterId,
    extends: "monster.template.phase0.t0",
    name: "铁甲熊",
    level: 8,
    growth: {
      [ATTR.CON]: 10,
      [ATTR.PDEF]: 1,
    },
    rewards: {
      charXp: 50,
      currencies: { [CURRENCY_GOLD]: 8 },
    },
  },
} satisfies Record<string, AuthoringDef<MonsterDef>>;
