import { ATTR } from "../../../core/entity/attribute";
import type { MonsterDef, MonsterId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";
import { basicAttackTalent } from "../talents";
import { CURRENCY_GOLD } from "../currencies";
import { BASE_ATTRS, BASE_GROWTH } from "../baseline";

// 怪物基准模板：人怪同模，和英雄共享 baseline.ts 中的基准值。
// 标准怪物继承此模板后不需要覆写任何属性——直接代表"同级平均战力"。
// Phase 0 的四档怪物都覆写了具体属性（整体偏弱于玩家）。
export const monsterTemplateDrafts = {
  "monster.template.base": {
    id: "monster.template.base" as MonsterId,
    abstract: true,
    level: 1,
    baseAttrs: { ...BASE_ATTRS },
    growth: { ...BASE_GROWTH },
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
    talents: [basicAttackTalent.id],
    rewards: {
      charXp: 1,
      currencies: { [CURRENCY_GOLD]: 0 },
    },
  },
} satisfies Record<string, AuthoringDef<MonsterDef>>;
