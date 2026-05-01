import { ATTR } from "../../../core/entity/attribute";
import type { MonsterDef, MonsterId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";
import { basicAttackTalent } from "../talents";
import { CURRENCY_GOLD } from "../currencies";
import { BASE_GROWTH } from "../baseline";

// 怪物模板分层：
// - monster.template.base：抽象根（天赋 / 结算占位），不写数值锚点。
// - monster.template.phase0.t0：Phase0「人怪同模」标准 Tier0；成长与 baseline.ts 对齐，
//   STR/DEX/INT/CON/MAX_HP 由 compile 阶段按 growth×2 填锚点（见 monsters/index.ts）。
//   怪物不配 MRES；需要异常血量或护甲时再在具体怪物上覆写 growth / baseAttrs。

export const monsterTemplateDrafts = {
  "monster.template.base": {
    id: "monster.template.base" as MonsterId,
    abstract: true,
    level: 1,
    talents: [basicAttackTalent.id],
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
    rewards: {
      charXp: 1,
      currencies: { [CURRENCY_GOLD]: 0 },
    },
  },
  "monster.template.phase0.t0": {
    id: "monster.template.phase0.t0" as MonsterId,
    abstract: true,
    extends: "monster.template.base",
    baseAttrs: {
      [ATTR.MAX_MP]: 30,
      [ATTR.WEAPON_ATK]: 6,
      [ATTR.WEAPON_MATK]: 5,
      [ATTR.SPEED]: 40,
      [ATTR.PDEF]: 0,
    },
    growth: {
      ...BASE_GROWTH,
      [ATTR.STR]: 8,
      [ATTR.DEX]: 8,
      [ATTR.INT]: 4,
      [ATTR.CON]: 8,
    }
  },
} satisfies Record<string, AuthoringDef<MonsterDef>>;
