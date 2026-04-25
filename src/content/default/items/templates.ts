import type { ItemDef, ItemId } from "../../../core/content";
import type { AuthoringDef } from "../../compiler/inheritance";

export const itemTemplateDrafts = {
  "item.template.material.base": {
    id: "item.template.material.base" as ItemId,
    abstract: true,
    stackable: true,
  },
  "item.template.material.ore": {
    id: "item.template.material.ore" as ItemId,
    abstract: true,
    extends: "item.template.material.base",
    tags: ["ore"],
  },
  "item.template.material.monster_drop": {
    id: "item.template.material.monster_drop" as ItemId,
    abstract: true,
    extends: "item.template.material.base",
    tags: ["monster_drop"],
  },
  "item.template.weapon.base": {
    id: "item.template.weapon.base" as ItemId,
    abstract: true,
    stackable: false,
    slot: "weapon",
    tags: ["weapon"],
  },
  "item.template.weapon.sword": {
    id: "item.template.weapon.sword" as ItemId,
    abstract: true,
    extends: "item.template.weapon.base",
    tags: ["weapon", "sword"],
  },
  "item.template.weapon.bow": {
    id: "item.template.weapon.bow" as ItemId,
    abstract: true,
    extends: "item.template.weapon.base",
    tags: ["weapon", "bow"],
  },
  "item.template.weapon.staff": {
    id: "item.template.weapon.staff" as ItemId,
    abstract: true,
    extends: "item.template.weapon.base",
    tags: ["weapon", "staff"],
  },
  "item.template.weapon.scepter": {
    id: "item.template.weapon.scepter" as ItemId,
    abstract: true,
    extends: "item.template.weapon.base",
    tags: ["weapon", "scepter"],
  },
} satisfies Record<string, AuthoringDef<ItemDef>>;
