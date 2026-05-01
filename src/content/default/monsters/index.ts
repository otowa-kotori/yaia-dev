import type { MonsterDef } from "../../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../../compiler/inheritance";
import { applyGrowthAnchoredBaseAttrs } from "../baseline";
import { earlyGameMonsterDrafts } from "./early-game";
import { monsterTemplateDrafts } from "./templates";

const authoredMonsters = {
  ...monsterTemplateDrafts,
  ...earlyGameMonsterDrafts,
} satisfies Record<string, AuthoringDef<MonsterDef>>;

const compiledMonsters = compileInheritedCollection<MonsterDef>({
  bucketName: "monsters",
  defs: authoredMonsters,
});

/** 编译后将 growth 锚定的一级属性写入 baseAttrs（缺失键 → 2×growth）。 */
export const monsters = Object.fromEntries(
  Object.entries(compiledMonsters).map(([id, def]) => [id, applyGrowthAnchoredBaseAttrs(def)]),
) as Record<string, MonsterDef>;

export const tutorialSlime = monsters["monster.tutorial_slime"]!;
export const slime = monsters["monster.slime"]!;
export const wildBoar = monsters["monster.wild_boar"]!;
export const armoredBear = monsters["monster.armored_bear"]!;
