import type { DungeonDef, DungeonId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { CURRENCY_GOLD } from "./currencies";
import { slimeGel } from "./items";
import { goblin, slime } from "./monsters";

/** 史莱姆洞窟——三波固定顺序副本，适合两人组队。
 *  第一波：落单史莱姆试探。
 *  第二波：史莱姆群冲锋。
 *  第三波：哥布林指挥官 + 史莱姆护卫。
 *  通关额外奖励 10 金币。 */
export const slimeCaveDungeon: DungeonDef = {
  id: "dungeon.forest.slime_cave" as DungeonId,
  name: "史莱姆洞窟",
  recoverBelowHpFactor: 0.5,
  waveTransitionTicks: 10,
  minPartySize: 1,
  maxPartySize: 2,
  waves: [
    {
      id: "dungeon.slime_cave.wave0",
      name: "洞口哨兵",
      monsters: [slime.id],
      rewards: {
        drops: [{ itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 1 }],
        currencies: { [CURRENCY_GOLD]: 2 },
      },
    },
    {
      id: "dungeon.slime_cave.wave1",
      name: "史莱姆群涌",
      monsters: [slime.id, slime.id, slime.id],
      rewards: {
        drops: [{ itemId: slimeGel.id, chance: 1, minQty: 2, maxQty: 3 }],
        currencies: { [CURRENCY_GOLD]: 4 },
      },
    },
    {
      id: "dungeon.slime_cave.wave2",
      name: "哥布林指挥官",
      monsters: [goblin.id, slime.id, slime.id],
      rewards: {
        drops: [{ itemId: slimeGel.id, chance: 1, minQty: 1, maxQty: 2 }],
        currencies: { [CURRENCY_GOLD]: 6 },
      },
    },
  ],
  completionRewards: {
    currencies: { [CURRENCY_GOLD]: 10 },
  },
};

const authoredDungeons = {
  [slimeCaveDungeon.id]: slimeCaveDungeon,
} satisfies Record<string, AuthoringDef<DungeonDef>>;

export const dungeons = compileInheritedCollection<DungeonDef>({
  bucketName: "dungeons",
  defs: authoredDungeons,
});
