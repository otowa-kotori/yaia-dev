import type { LocationDef, LocationId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { copperMineCombat, slimeHard, slimeNormal, trainingGroundCombat } from "./combat-zones";
import { slimeCaveDungeon } from "./dungeons";
import { copperVein } from "./resource-nodes";

export const forestLocation: LocationDef = {
  id: "location.forest" as LocationId,
  name: "阳光森林",
  entries: [
    { kind: "combat", combatZoneId: slimeNormal.id, label: "史莱姆小径（普通）" },
    { kind: "combat", combatZoneId: slimeHard.id, label: "史莱姆巢穴（困难）" },
    { kind: "dungeon", dungeonId: slimeCaveDungeon.id, label: "史莱姆洞窟（副本）" },
  ],
};

export const copperMineLocation: LocationDef = {
  id: "location.mine.copper" as LocationId,
  name: "铜矿洞",
  entries: [
    { kind: "combat", combatZoneId: copperMineCombat.id, label: "矿洞深处（战斗）" },
    { kind: "gather", resourceNodes: [copperVein.id], label: "铜矿脉" },
  ],
};

/** 训练场 — 玩家可在此测试技能效果。 */
export const trainingGroundLocation: LocationDef = {
  id: "location.training" as LocationId,
  name: "训练场",
  entries: [{ kind: "combat", combatZoneId: trainingGroundCombat.id, label: "训练木人" }],
};

const authoredLocations = {
  [forestLocation.id]: forestLocation,
  [copperMineLocation.id]: copperMineLocation,
  [trainingGroundLocation.id]: trainingGroundLocation,
} satisfies Record<string, AuthoringDef<LocationDef>>;

export const locations = compileInheritedCollection<LocationDef>({
  bucketName: "locations",
  defs: authoredLocations,
});
