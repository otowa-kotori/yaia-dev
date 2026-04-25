import type { MonsterDef } from "../../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../../compiler/inheritance";
import { earlyGameMonsterDrafts } from "./early-game";
import { monsterTemplateDrafts } from "./templates";

const authoredMonsters = {
  ...monsterTemplateDrafts,
  ...earlyGameMonsterDrafts,
} satisfies Record<string, AuthoringDef<MonsterDef>>;

export const monsters = compileInheritedCollection<MonsterDef>({
  bucketName: "monsters",
  defs: authoredMonsters,
});

export const greenSlime = monsters["monster.green_slime"]!;
export const slime = monsters["monster.slime"]!;
export const wildBoar = monsters["monster.wild_boar"]!;
export const hornedRabbit = monsters["monster.horned_rabbit"]!;
export const bigSlime = monsters["monster.big_slime"]!;
export const poisonMushroom = monsters["monster.poison_mushroom"]!;
export const duskWolf = monsters["monster.dusk_wolf"]!;
export const skeletonSoldier = monsters["monster.skeleton_soldier"]!;
export const direWolf = monsters["monster.dire_wolf"]!;
export const caveBat = monsters["monster.cave_bat"]!;
export const shadowFiend = monsters["monster.shadow_fiend"]!;
export const oreCrab = monsters["monster.ore_crab"]!;
export const blackfangAlpha = monsters["monster.blackfang_alpha"]!;
export const trainingDummy = monsters["monster.training_dummy"]!;
