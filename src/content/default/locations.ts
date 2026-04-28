import type { LocationDef, LocationId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import {
  mineBatCrabMix,
  mineBatShadowMix,
  mineCaveBat,
  mineOreCrab,
  mineShadowFiend,
  prairieApproach,
  prairieBramble,
  prairieCreek,
  prairieCrossroad,
  prairieDustway,
  prairieGrove,
  prairieHeartland,
  prairieMarsh,
  prairiePasture,
  prairieRidge,
  trainingGroundCombat,
  twilightDuskWolf,
  twilightPoisonMushroom,
  twilightSkeletonSoldier,
} from "./combat-zones";
import { blackfangSanctumDungeon, wolfDenDungeon } from "./dungeons";
import { copperVein } from "./resource-nodes";
import {
  unlockLocationBossSanctum,
  unlockLocationIronMine,
  unlockLocationTraining,
  unlockLocationTwilight,
} from "./unlocks";

export const prairieLocation: LocationDef = {
  id: "location.prairie" as LocationId,
  name: "翠风草原",
  entries: [
    { kind: "combat", combatZoneId: prairieApproach.id, label: "1-1" },
    { kind: "combat", combatZoneId: prairieCreek.id, label: "1-2" },
    { kind: "combat", combatZoneId: prairieGrove.id, label: "1-3" },
    { kind: "combat", combatZoneId: prairieRidge.id, label: "1-4" },
    { kind: "combat", combatZoneId: prairieCrossroad.id, label: "1-5" },
    { kind: "combat", combatZoneId: prairiePasture.id, label: "1-6" },
    { kind: "combat", combatZoneId: prairieDustway.id, label: "1-7" },
    { kind: "combat", combatZoneId: prairieBramble.id, label: "1-8" },
    { kind: "combat", combatZoneId: prairieMarsh.id, label: "1-9" },
    { kind: "combat", combatZoneId: prairieHeartland.id, label: "1-10" },
  ],
};

export const twilightLocation: LocationDef = {
  id: "location.twilight" as LocationId,
  name: "暮色林地",
  unlockId: unlockLocationTwilight.id,
  entries: [
    { kind: "combat", combatZoneId: twilightPoisonMushroom.id, label: "2-1 毒蘑菇" },
    { kind: "combat", combatZoneId: twilightDuskWolf.id, label: "2-2 暮色狼" },
    { kind: "combat", combatZoneId: twilightSkeletonSoldier.id, label: "2-3 骸骨兵" },
    { kind: "dungeon", dungeonId: wolfDenDungeon.id, label: "2-4 狼穴" },
  ],
};

export const ironMineLocation: LocationDef = {
  id: "location.mine.ironfang" as LocationId,
  name: "铁牙矿坑",
  unlockId: unlockLocationIronMine.id,
  entries: [
    { kind: "combat", combatZoneId: mineCaveBat.id, label: "3-1 洞穴蝙蝠" },
    { kind: "combat", combatZoneId: mineShadowFiend.id, label: "3-2 暗影魔" },
    { kind: "combat", combatZoneId: mineOreCrab.id, label: "3-3 矿石蟹" },
    { kind: "combat", combatZoneId: mineBatShadowMix.id, label: "3-4 蝙蝠 + 暗影魔" },
    { kind: "combat", combatZoneId: mineBatCrabMix.id, label: "3-5 蝙蝠 + 矿石蟹" },
    { kind: "gather", resourceNodes: [copperVein.id], label: "矿脉试采点" },
  ],
};

export const bossSanctumLocation: LocationDef = {
  id: "location.boss.blackfang" as LocationId,
  name: "黑牙兽巢",
  unlockId: unlockLocationBossSanctum.id,
  entries: [{ kind: "dungeon", dungeonId: blackfangSanctumDungeon.id, label: "首领战：黑牙兽王" }],
};

/** 训练场 — 玩家可在此测试技能效果。 */
export const trainingGroundLocation: LocationDef = {
  id: "location.training" as LocationId,
  name: "训练场",
  unlockId: unlockLocationTraining.id,
  entries: [{ kind: "combat", combatZoneId: trainingGroundCombat.id, label: "训练木人" }],
};

const authoredLocations = {
  [prairieLocation.id]: prairieLocation,
  [twilightLocation.id]: twilightLocation,
  [ironMineLocation.id]: ironMineLocation,
  [bossSanctumLocation.id]: bossSanctumLocation,
  [trainingGroundLocation.id]: trainingGroundLocation,
} satisfies Record<string, AuthoringDef<LocationDef>>;

export const locations = compileInheritedCollection<LocationDef>({
  bucketName: "locations",
  defs: authoredLocations,
});
