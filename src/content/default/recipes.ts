import type { RecipeDef } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";

// Phase 0：无制造内容。

const authoredRecipes = {} satisfies Record<string, AuthoringDef<RecipeDef>>;

export const recipes = compileInheritedCollection<RecipeDef>({
  bucketName: "recipes",
  defs: authoredRecipes,
});
