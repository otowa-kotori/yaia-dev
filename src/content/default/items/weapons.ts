import { ATTR } from "../../../core/entity/attribute";
import type { ItemDef, ItemId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";

// Phase 0 武器：三把初始武器，覆盖三角色。
export const itemWeaponDrafts = {
  "item.weapon.training_sword": {
    id: "item.weapon.training_sword" as ItemId,
    extends: "item.template.weapon.sword",
    name: "训练木剑",
    description: "给新手练手用的木制短剑。",
    modifiers: [
      { stat: ATTR.WEAPON_ATK, op: "flat", value: 2, sourceId: "item.weapon.training_sword" },
    ],
    tags: ["weapon", "sword", "starter"],
  },
  "item.weapon.training_spear": {
    id: "item.weapon.training_spear" as ItemId,
    extends: "item.template.weapon.sword",
    name: "训练长枪",
    description: "蕾米莉亚的初始长枪，朴素但锋利。",
    modifiers: [
      { stat: ATTR.WEAPON_ATK, op: "flat", value: 2, sourceId: "item.weapon.training_spear" },
    ],
    tags: ["weapon", "spear", "starter"],
  },
  "item.weapon.training_staff": {
    id: "item.weapon.training_staff" as ItemId,
    extends: "item.template.weapon.staff",
    name: "训练法杖",
    description: "帕秋莉的启蒙法杖，导魔效率低但聊胜于无。",
    modifiers: [
      { stat: ATTR.WEAPON_MATK, op: "flat", value: 5, sourceId: "item.weapon.training_staff" },
    ],
    tags: ["weapon", "staff", "starter"],
  },
} satisfies Record<string, AuthoringDef<ItemDef>>;
