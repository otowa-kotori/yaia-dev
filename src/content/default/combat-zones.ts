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

export const prairieGreenSlime: CombatZoneDef = {
  id: "combatzone.prairie.1_1_green_slime" as CombatZoneId,
  name: "翠风草原 1-1：绿史莱姆",
  waveSelection: "random",
  waveSearchTicks: 20,
  recoverBelowHpFactor: 0.4,
  minPartySize: 1,
  maxPartySize: 1,
  waves: [
    { id: "wave.prairie.1_1.single", name: "教学靶子", monsters: [greenSlime.id] },
    { id: "wave.prairie.1_1.pair", name: "慢吞吞两只", monsters: [greenSlime.id, greenSlime.id] },
  ],
};

export const prairieSlime: CombatZoneDef = {
  id: "combatzone.prairie.1_2_slime" as CombatZoneId,
  name: "翠风草原 1-2：史莱姆",
  waveSelection: "random",
  waveSearchTicks: 20,
  recoverBelowHpFactor: 0.45,
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ id: "wave.prairie.1_2", name: "正式挂机点", monsters: [slime.id, slime.id] }],
};

export const prairieWildBoar: CombatZoneDef = {
  id: "combatzone.prairie.1_3_boar" as CombatZoneId,
  name: "翠风草原 1-3：野猪",
  waveSelection: "random",
  waveSearchTicks: 20,
  recoverBelowHpFactor: 0.5,
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ id: "wave.prairie.1_3", name: "冲撞野猪", monsters: [wildBoar.id, wildBoar.id] }],
};

export const prairieHornedRabbit: CombatZoneDef = {
  id: "combatzone.prairie.1_4_rabbit" as CombatZoneId,
  name: "翠风草原 1-4：角兔",
  waveSelection: "random",
  waveSearchTicks: 20,
  recoverBelowHpFactor: 0.5,
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ id: "wave.prairie.1_4", name: "抢先扑击", monsters: [hornedRabbit.id, hornedRabbit.id] }],
};

export const prairieBigSlime: CombatZoneDef = {
  id: "combatzone.prairie.1_5_big_slime" as CombatZoneId,
  name: "翠风草原 1-5：大史莱姆",
  waveSelection: "random",
  waveSearchTicks: 22,
  recoverBelowHpFactor: 0.55,
  minPartySize: 1,
  maxPartySize: 1,
  waves: [{ id: "wave.prairie.1_5", name: "毕业史莱姆", monsters: [bigSlime.id] }],
};

export const twilightPoisonMushroom: CombatZoneDef = {
  id: "combatzone.twilight.2_1_mushroom" as CombatZoneId,
  name: "暮色林地 2-1：毒蘑菇",
  waveSelection: "random",
  waveSearchTicks: 22,
  recoverBelowHpFactor: 0.55,
  minPartySize: 1,
  maxPartySize: 2,
  waves: [{ id: "wave.twilight.2_1", name: "毒孢林地", monsters: [poisonMushroom.id, poisonMushroom.id] }],
};

export const twilightDuskWolf: CombatZoneDef = {
  id: "combatzone.twilight.2_2_wolf" as CombatZoneId,
  name: "暮色林地 2-2：暮色狼",
  waveSelection: "random",
  waveSearchTicks: 22,
  recoverBelowHpFactor: 0.55,
  minPartySize: 1,
  maxPartySize: 2,
  waves: [
    { id: "wave.twilight.2_2.duo", name: "双狼巡行", monsters: [duskWolf.id, duskWolf.id] },
    { id: "wave.twilight.2_2.pack", name: "三狼包夹", monsters: [duskWolf.id, duskWolf.id, duskWolf.id] },
  ],
};

export const twilightSkeletonSoldier: CombatZoneDef = {
  id: "combatzone.twilight.2_3_skeleton" as CombatZoneId,
  name: "暮色林地 2-3：骸骨兵",
  waveSelection: "random",
  waveSearchTicks: 24,
  recoverBelowHpFactor: 0.6,
  minPartySize: 1,
  maxPartySize: 2,
  waves: [{ id: "wave.twilight.2_3", name: "重甲亡骨", monsters: [skeletonSoldier.id, skeletonSoldier.id] }],
};

export const mineCaveBat: CombatZoneDef = {
  id: "combatzone.mine.3_1_bat" as CombatZoneId,
  name: "铁牙矿坑 3-1：洞穴蝙蝠",
  waveSelection: "random",
  waveSearchTicks: 24,
  recoverBelowHpFactor: 0.55,
  minPartySize: 1,
  maxPartySize: 2,
  waves: [
    { id: "wave.mine.3_1.full", name: "四翼压制", monsters: [caveBat.id, caveBat.id, caveBat.id, caveBat.id] },
    { id: "wave.mine.3_1.trim", name: "三翼先遣", monsters: [caveBat.id, caveBat.id, caveBat.id] },
  ],
};

export const mineShadowFiend: CombatZoneDef = {
  id: "combatzone.mine.3_2_shadow" as CombatZoneId,
  name: "铁牙矿坑 3-2：暗影魔",
  waveSelection: "random",
  waveSearchTicks: 24,
  recoverBelowHpFactor: 0.6,
  minPartySize: 1,
  maxPartySize: 2,
  waves: [{ id: "wave.mine.3_2", name: "暗影双子", monsters: [shadowFiend.id, shadowFiend.id] }],
};

export const mineOreCrab: CombatZoneDef = {
  id: "combatzone.mine.3_3_crab" as CombatZoneId,
  name: "铁牙矿坑 3-3：矿石蟹",
  waveSelection: "random",
  waveSearchTicks: 24,
  recoverBelowHpFactor: 0.65,
  minPartySize: 1,
  maxPartySize: 2,
  waves: [{ id: "wave.mine.3_3", name: "裂甲横行", monsters: [oreCrab.id, oreCrab.id] }],
};

export const mineBatShadowMix: CombatZoneDef = {
  id: "combatzone.mine.3_4_mix_shadow" as CombatZoneId,
  name: "铁牙矿坑 3-4：蝙蝠 + 暗影魔",
  waveSelection: "random",
  waveSearchTicks: 26,
  recoverBelowHpFactor: 0.65,
  minPartySize: 1,
  maxPartySize: 4,
  waves: [
    { id: "wave.mine.3_4.full", name: "暗影蝠群", monsters: [caveBat.id, caveBat.id, caveBat.id, shadowFiend.id] },
    { id: "wave.mine.3_4.alt", name: "暗影先遣", monsters: [caveBat.id, caveBat.id, shadowFiend.id] },
  ],
};

export const mineBatCrabMix: CombatZoneDef = {
  id: "combatzone.mine.3_5_mix_crab" as CombatZoneId,
  name: "铁牙矿坑 3-5：蝙蝠 + 矿石蟹",
  waveSelection: "random",
  waveSearchTicks: 26,
  recoverBelowHpFactor: 0.7,
  minPartySize: 1,
  maxPartySize: 4,
  waves: [
    { id: "wave.mine.3_5.full", name: "矿坑夹击", monsters: [caveBat.id, caveBat.id, oreCrab.id] },
    { id: "wave.mine.3_5.alt", name: "甲壳蝠潮", monsters: [caveBat.id, caveBat.id, caveBat.id, oreCrab.id] },
  ],
};

export const trainingGroundCombat: CombatZoneDef = {
  id: "combatzone.training.dummy" as CombatZoneId,
  name: "训练场",
  waveSelection: "random",
  waveSearchTicks: 5,
  recoverBelowHpFactor: 0.3,
  minPartySize: 1,
  maxPartySize: 4,
  waves: [{ id: "wave.training.dummy", name: "训练木人", monsters: [trainingDummy.id] }],
};

const authoredCombatZones = {
  [prairieGreenSlime.id]: prairieGreenSlime,
  [prairieSlime.id]: prairieSlime,
  [prairieWildBoar.id]: prairieWildBoar,
  [prairieHornedRabbit.id]: prairieHornedRabbit,
  [prairieBigSlime.id]: prairieBigSlime,
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
