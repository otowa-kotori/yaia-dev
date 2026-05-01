import type { ItemDef } from "../../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../../compiler/inheritance";
import { itemMaterialDrafts } from "./materials";
import { itemTemplateDrafts } from "./templates";
import { itemWeaponDrafts } from "./weapons";

const authoredItems = {
  ...itemTemplateDrafts,
  ...itemMaterialDrafts,
  ...itemWeaponDrafts,
} satisfies Record<string, AuthoringDef<ItemDef>>;

export const items = compileInheritedCollection<ItemDef>({
  bucketName: "items",
  defs: authoredItems,
});

export const trainingSword = items["item.weapon.training_sword"]!;
export const trainingSpear = items["item.weapon.training_spear"]!;
export const trainingStaff = items["item.weapon.training_staff"]!;
