import type { CombatZoneDef, CombatZoneId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { CURRENCY_GOLD } from "./currencies";
import { copperOre, slimeGel } from "./items";
import { caveBat, goblin, slime, trainingDummy } from "./monsters";

/** Normal difficulty: single slime per wave. Suitable for beginners. */
export const slimeNormal: CombatZoneDef = {
  id: "combatzone.forest.slime_normal" as CombatZoneId,
  name: "史莱姆小径（普通）",
  waveSelection: "random",
  waveSearchTicks: 20,
  recoverBelowHpFactor: 0.5,
  waves: [
    {
      id: "wave.forest.lone_slime",
      name: "落单史莱姆",
      monsters: [slime.id],
      rewards: {
        drops: [{ itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 1 }],
        currencies: { [CURRENCY_GOLD]: 1 },
      },
    },
  ],
};

/** Hard difficulty: double slime or mixed pack. Higher rewards. */
export const slimeHard: CombatZoneDef = {
  id: "combatzone.forest.slime_hard" as CombatZoneId,
  name: "史莱姆巢穴（困难）",
  waveSelection: "random",
  waveSearchTicks: 20,
  recoverBelowHpFactor: 0.5,
  waves: [
    {
      id: "wave.forest.slime_pack",
      name: "史莱姆群",
      monsters: [slime.id, slime.id],
      rewards: {
        drops: [{ itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 2 }],
        currencies: { [CURRENCY_GOLD]: 2 },
      },
    },
    {
      id: "wave.forest.goblin_patrol",
      name: "哥布林巡逻队",
      monsters: [slime.id, goblin.id],
      rewards: {
        drops: [{ itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 1 }],
        currencies: { [CURRENCY_GOLD]: 4 },
      },
    },
  ],
};

/** Copper mine combat zone — bat/goblin mix, showcases ATB speed diversity. */
export const copperMineCombat: CombatZoneDef = {
  id: "combatzone.mine.copper_monsters" as CombatZoneId,
  name: "矿洞深处（战斗）",
  waveSelection: "random",
  waveSearchTicks: 20,
  recoverBelowHpFactor: 0.5,
  waves: [
    {
      id: "wave.mine.bat_pair",
      name: "蝙蝠群",
      monsters: [caveBat.id, caveBat.id],
      rewards: {
        drops: [{ itemId: copperOre.id, chance: 0.5, minQty: 1, maxQty: 1 }],
        currencies: { [CURRENCY_GOLD]: 3 },
      },
    },
    {
      id: "wave.mine.goblin_bat",
      name: "哥布林与蝙蝠",
      monsters: [goblin.id, caveBat.id],
      rewards: {
        drops: [{ itemId: copperOre.id, chance: 0.5, minQty: 1, maxQty: 1 }],
        currencies: { [CURRENCY_GOLD]: 4 },
      },
    },
  ],
};

/** 训练场 — 单个训练木人，用于测试技能效果和数值验证。 */
export const trainingGroundCombat: CombatZoneDef = {
  id: "combatzone.training.dummy" as CombatZoneId,
  name: "训练场",
  waveSelection: "random",
  waveSearchTicks: 5,
  recoverBelowHpFactor: 0.3,
  waves: [
    {
      id: "wave.training.dummy",
      name: "训练木人",
      monsters: [trainingDummy.id],
    },
  ],
};

const authoredCombatZones = {
  [slimeNormal.id]: slimeNormal,
  [slimeHard.id]: slimeHard,
  [copperMineCombat.id]: copperMineCombat,
  [trainingGroundCombat.id]: trainingGroundCombat,
} satisfies Record<string, AuthoringDef<CombatZoneDef>>;

export const combatZones = compileInheritedCollection<CombatZoneDef>({
  bucketName: "combatZones",
  defs: authoredCombatZones,
});
