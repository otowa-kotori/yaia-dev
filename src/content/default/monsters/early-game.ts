import { ATTR } from "../../../core/entity/attribute";
import type { MonsterDef, MonsterId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";
import { CURRENCY_GOLD } from "../currencies";

export const earlyGameMonsterDrafts = {
  "monster.slime": {
    id: "monster.slime" as MonsterId,
    extends: "monster.template.base",
    name: "史莱姆",
    baseAttrs: {
      [ATTR.MAX_HP]: 30,
      [ATTR.WEAPON_ATK]: 4,
      [ATTR.PDEF]: 1,
      [ATTR.SPEED]: 12,
    },
    xpReward: 10,
    currencyReward: { [CURRENCY_GOLD]: 5 },
  },
  "monster.goblin": {
    id: "monster.goblin" as MonsterId,
    extends: "monster.template.base",
    name: "哥布林",
    baseAttrs: {
      [ATTR.MAX_HP]: 24,
      [ATTR.WEAPON_ATK]: 6,
      [ATTR.SPEED]: 32,
    },
    xpReward: 14,
    currencyReward: { [CURRENCY_GOLD]: 7 },
  },
  "monster.cave_bat": {
    id: "monster.cave_bat" as MonsterId,
    extends: "monster.template.base",
    name: "洞穴蝙蝠",
    level: 2,
    baseAttrs: {
      [ATTR.MAX_HP]: 16,
      [ATTR.WEAPON_ATK]: 5,
      [ATTR.SPEED]: 72,
    },
    xpReward: 12,
    currencyReward: { [CURRENCY_GOLD]: 6 },
  },
  "monster.training_dummy": {
    id: "monster.training_dummy" as MonsterId,
    extends: "monster.template.base",
    name: "训练木人",
    baseAttrs: {
      [ATTR.MAX_HP]: 99999,
      [ATTR.WEAPON_ATK]: 1,
    },
    xpReward: 1,
    currencyReward: { [CURRENCY_GOLD]: 0 },
  },
} satisfies Record<string, AuthoringDef<MonsterDef>>;
