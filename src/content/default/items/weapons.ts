import { ATTR } from "../../../core/entity/attribute";
import type { ItemDef, ItemId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";

export const itemWeaponDrafts = {
  "item.weapon.training_sword": {
    id: "item.weapon.training_sword" as ItemId,
    extends: "item.template.weapon.sword",
    name: "训练木剑",
    description: "给新手练手用的木制短剑，虽然朴素，但总比空手强。",
    modifiers: [
      { stat: ATTR.WEAPON_ATK, op: "flat", value: 2, sourceId: "item.weapon.training_sword" },
    ],
    tags: ["weapon", "sword", "starter"],
  },
  "item.weapon.training_bow": {
    id: "item.weapon.training_bow" as ItemId,
    extends: "item.template.weapon.bow",
    name: "训练短弓",
    description: "简陋的练习短弓，轻巧但威力有限，游侠的入门装备。",
    modifiers: [
      { stat: ATTR.WEAPON_ATK, op: "flat", value: 2, sourceId: "item.weapon.training_bow" },
    ],
    tags: ["weapon", "bow", "starter"],
  },
  "item.weapon.training_staff": {
    id: "item.weapon.training_staff" as ItemId,
    extends: "item.template.weapon.staff",
    name: "训练法杖",
    description: "新手魔法师的启蒙法杖，导魔效率低，但聊胜于无。",
    modifiers: [
      { stat: ATTR.WEAPON_MATK, op: "flat", value: 2, sourceId: "item.weapon.training_staff" },
    ],
    tags: ["weapon", "staff", "starter"],
  },
  "item.weapon.training_scepter": {
    id: "item.weapon.training_scepter" as ItemId,
    extends: "item.template.weapon.scepter",
    name: "见习权杖",
    description: "圣女见习时持用的权杖，附有轻微的神圣回路加持。",
    modifiers: [
      { stat: ATTR.WEAPON_MATK, op: "flat", value: 2, sourceId: "item.weapon.training_scepter" },
      { stat: ATTR.MAX_MP, op: "flat", value: 10, sourceId: "item.weapon.training_scepter" },
    ],
    tags: ["weapon", "scepter", "starter"],
  },
  "item.weapon.copper_sword": {
    id: "item.weapon.copper_sword" as ItemId,
    extends: "item.template.weapon.sword",
    name: "铜剑",
    description: "用铜矿和史莱姆胶拼成的初阶短剑，刃口粗糙但已经足够实战。",
    modifiers: [
      { stat: ATTR.WEAPON_ATK, op: "flat", value: 8, sourceId: "item.weapon.copper_sword" },
    ],
    tags: ["weapon", "sword", "crafted"],
  },
} satisfies Record<string, AuthoringDef<ItemDef>>;
