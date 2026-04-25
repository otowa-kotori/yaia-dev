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

export const copperOre = items["item.ore.copper"]!;
export const slimeGel = items["item.monster.slime_gel"]!;
export const beastHide = items["item.monster.beast_hide"]!;
export const twilightEssence = items["item.monster.twilight_essence"]!;
export const boneDust = items["item.monster.bone_dust"]!;
export const wolfKingFang = items["item.monster.wolf_king_fang"]!;
export const carapace = items["item.monster.carapace"]!;
export const shadowCore = items["item.monster.shadow_core"]!;
export const bossCore = items["item.monster.boss_core"]!;
export const trainingSword = items["item.weapon.training_sword"]!;
export const trainingBow = items["item.weapon.training_bow"]!;
export const trainingStaff = items["item.weapon.training_staff"]!;
export const trainingScepter = items["item.weapon.training_scepter"]!;
export const copperSword = items["item.weapon.copper_sword"]!;
