import type { CombatZoneDef, CombatZoneId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import {
  bigSlime,
  caveBat,
  duskWolf,
  greenSlime,
  hornedRabbit,
  oreCrab,
  poisonMushroom,
  shadowFiend,
  skeletonSoldier,
  slime,
  trainingDummy,
  wildBoar,
} from "./monsters";

export const prairieApproach: CombatZoneDef = {
  id: "combatzone.prairie.1_1" as CombatZoneId,
  name: "翠风草原 1-1",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [greenSlime.id] }],
};

export const prairieCreek: CombatZoneDef = {
  id: "combatzone.prairie.1_2" as CombatZoneId,
  name: "翠风草原 1-2",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [slime.id] }],
};

export const prairieGrove: CombatZoneDef = {
  id: "combatzone.prairie.1_3" as CombatZoneId,
  name: "翠风草原 1-3",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [slime.id, greenSlime.id] }],
};

export const prairieRidge: CombatZoneDef = {
  id: "combatzone.prairie.1_4" as CombatZoneId,
  name: "翠风草原 1-4",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [wildBoar.id] }],
};

export const prairieCrossroad: CombatZoneDef = {
  id: "combatzone.prairie.1_5" as CombatZoneId,
  name: "翠风草原 1-5",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [slime.id, slime.id] }],
};

export const prairiePasture: CombatZoneDef = {
  id: "combatzone.prairie.1_6" as CombatZoneId,
  name: "翠风草原 1-6",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [wildBoar.id, slime.id] }],
};

export const prairieDustway: CombatZoneDef = {
  id: "combatzone.prairie.1_7" as CombatZoneId,
  name: "翠风草原 1-7",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [hornedRabbit.id, wildBoar.id] }],
};

export const prairieBramble: CombatZoneDef = {
  id: "combatzone.prairie.1_8" as CombatZoneId,
  name: "翠风草原 1-8",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [hornedRabbit.id, hornedRabbit.id] }],
};

export const prairieMarsh: CombatZoneDef = {
  id: "combatzone.prairie.1_9" as CombatZoneId,
  name: "翠风草原 1-9",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [bigSlime.id] }],
};

export const prairieHeartland: CombatZoneDef = {
  id: "combatzone.prairie.1_10" as CombatZoneId,
  name: "翠风草原 1-10",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ monsters: [bigSlime.id, bigSlime.id] }],
};

export const twilightPoisonMushroom: CombatZoneDef = {
  id: "combatzone.twilight.2_1_mushroom" as CombatZoneId,
  name: "暮色林地 2-1：毒蘑菇",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 2,
  waves: [{ monsters: [poisonMushroom.id, poisonMushroom.id] }],
};

export const twilightDuskWolf: CombatZoneDef = {
  id: "combatzone.twilight.2_2_wolf" as CombatZoneId,
  name: "暮色林地 2-2：暮色狼",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 2,
  waves: [
    { monsters: [duskWolf.id, duskWolf.id] },
    { monsters: [duskWolf.id, duskWolf.id, duskWolf.id] },
  ],
};

export const twilightSkeletonSoldier: CombatZoneDef = {
  id: "combatzone.twilight.2_3_skeleton" as CombatZoneId,
  name: "暮色林地 2-3：骸骨兵",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 2,
  waves: [{ monsters: [skeletonSoldier.id, skeletonSoldier.id] }],
};

export const mineCaveBat: CombatZoneDef = {
  id: "combatzone.mine.3_1_bat" as CombatZoneId,
  name: "铁牙矿坑 3-1：洞穴蝙蝠",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 2,
  waves: [
    { monsters: [caveBat.id, caveBat.id, caveBat.id, caveBat.id] },
    { monsters: [caveBat.id, caveBat.id, caveBat.id] },
  ],
};

export const mineShadowFiend: CombatZoneDef = {
  id: "combatzone.mine.3_2_shadow" as CombatZoneId,
  name: "铁牙矿坑 3-2：暗影魔",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 2,
  waves: [{ monsters: [shadowFiend.id, shadowFiend.id] }],
};

export const mineOreCrab: CombatZoneDef = {
  id: "combatzone.mine.3_3_crab" as CombatZoneId,
  name: "铁牙矿坑 3-3：矿石蟹",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 2,
  waves: [{ monsters: [oreCrab.id, oreCrab.id] }],
};

export const mineBatShadowMix: CombatZoneDef = {
  id: "combatzone.mine.3_4_mix_shadow" as CombatZoneId,
  name: "铁牙矿坑 3-4：蝙蝠 + 暗影魔",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 4,
  waves: [
    { monsters: [caveBat.id, caveBat.id, caveBat.id, shadowFiend.id] },
    { monsters: [caveBat.id, caveBat.id, shadowFiend.id] },
  ],
};

export const mineBatCrabMix: CombatZoneDef = {
  id: "combatzone.mine.3_5_mix_crab" as CombatZoneId,
  name: "铁牙矿坑 3-5：蝙蝠 + 矿石蟹",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 4,
  waves: [
    { monsters: [caveBat.id, caveBat.id, oreCrab.id] },
    { monsters: [caveBat.id, caveBat.id, caveBat.id, oreCrab.id] },
  ],
};

export const trainingGroundCombat: CombatZoneDef = {
  id: "combatzone.training.dummy" as CombatZoneId,
  name: "训练场",
  waveSelection: "random",
  minPartySize: 1,
  maxPartySize: 4,
  waves: [{ monsters: [trainingDummy.id] }],
};

const authoredCombatZones = {
  [prairieApproach.id]: prairieApproach,
  [prairieCreek.id]: prairieCreek,
  [prairieGrove.id]: prairieGrove,
  [prairieRidge.id]: prairieRidge,
  [prairieCrossroad.id]: prairieCrossroad,
  [prairiePasture.id]: prairiePasture,
  [prairieDustway.id]: prairieDustway,
  [prairieBramble.id]: prairieBramble,
  [prairieMarsh.id]: prairieMarsh,
  [prairieHeartland.id]: prairieHeartland,
  [twilightPoisonMushroom.id]: twilightPoisonMushroom,
  [twilightDuskWolf.id]: twilightDuskWolf,
  [twilightSkeletonSoldier.id]: twilightSkeletonSoldier,
  [mineCaveBat.id]: mineCaveBat,
  [mineShadowFiend.id]: mineShadowFiend,
  [mineOreCrab.id]: mineOreCrab,
  [mineBatShadowMix.id]: mineBatShadowMix,
  [mineBatCrabMix.id]: mineBatCrabMix,
  [trainingGroundCombat.id]: trainingGroundCombat,
} satisfies Record<string, AuthoringDef<CombatZoneDef>>;

export const combatZones = compileInheritedCollection<CombatZoneDef>({
  bucketName: "combatZones",
  defs: authoredCombatZones,
});
