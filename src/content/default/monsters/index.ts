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

export const tutorialSlime = monsters["monster.tutorial_slime"]!;
export const slime = monsters["monster.slime"]!;
export const wildBoar = monsters["monster.wild_boar"]!;
export const armoredBear = monsters["monster.armored_bear"]!;
