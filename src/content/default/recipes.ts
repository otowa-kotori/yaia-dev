import type { RecipeDef, RecipeId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { copperOre, copperSword, slimeGel } from "./items";
import { smithingSkill } from "./skills";

export const copperSwordRecipe: RecipeDef = {
  id: "recipe.craft.copper_sword" as RecipeId,
  name: "锻造铜剑",
  skill: smithingSkill.id,
  requiredLevel: 1,
  durationTicks: 10,
  inputs: [
    { itemId: copperOre.id, qty: 3 },
    { itemId: slimeGel.id, qty: 2 },
  ],
  outputs: [{ itemId: copperSword.id, qty: 1 }],
  xpReward: 8,
};

const authoredRecipes = {
  [copperSwordRecipe.id]: copperSwordRecipe,
} satisfies Record<string, AuthoringDef<RecipeDef>>;

export const recipes = compileInheritedCollection<RecipeDef>({
  bucketName: "recipes",
  defs: authoredRecipes,
});
