import { ATTR } from "../../../core/entity/attribute";
import type { MonsterDef, MonsterId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";
import { basicAttackTalent } from "../talents";
import { CURRENCY_GOLD } from "../currencies";

export const monsterTemplateDrafts = {
  "monster.template.base": {
    id: "monster.template.base" as MonsterId,
    abstract: true,
    level: 1,
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
    baseAttrs: {
      [ATTR.PDEF]: 0,
      [ATTR.SPEED]: 30,
    },
    talents: [basicAttackTalent.id],
    drops: [],
    xpReward: 1,
    currencyReward: { [CURRENCY_GOLD]: 0 },
  },
} satisfies Record<string, AuthoringDef<MonsterDef>>;
