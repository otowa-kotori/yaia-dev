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

export const slime = monsters["monster.slime"]!;
export const goblin = monsters["monster.goblin"]!;
export const caveBat = monsters["monster.cave_bat"]!;
export const trainingDummy = monsters["monster.training_dummy"]!;
