import type { DungeonDef, DungeonId } from "../../core/content";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { direWolf, duskWolf, blackfangAlpha, caveBat, oreCrab } from "./monsters";

export const wolfDenDungeon: DungeonDef = {
  id: "dungeon.twilight.wolf_den" as DungeonId,
  name: "狼穴",
  minPartySize: 1,
  maxPartySize: 3,
  waves: [
    {
      id: "dungeon.wolf_den.wave0",
      name: "狼群热身",
      monsters: [duskWolf.id, duskWolf.id, duskWolf.id, duskWolf.id],
    },
    {
      id: "dungeon.wolf_den.wave1",
      name: "巨狼现身",
      monsters: [duskWolf.id, duskWolf.id, duskWolf.id, direWolf.id],
    },
    {
      id: "dungeon.wolf_den.wave2",
      name: "双巨狼压阵",
      monsters: [duskWolf.id, duskWolf.id, direWolf.id, direWolf.id],
    },
  ],
};

export const blackfangSanctumDungeon: DungeonDef = {
  id: "dungeon.boss.blackfang_sanctum" as DungeonId,
  name: "黑牙兽巢",
  minPartySize: 1,
  maxPartySize: 3,
  waves: [
    {
      id: "dungeon.blackfang.wave0",
      name: "矿坑余孽",
      monsters: [caveBat.id, caveBat.id, oreCrab.id],
    },
    {
      id: "dungeon.blackfang.wave1",
      name: "黑牙近卫",
      monsters: [direWolf.id, direWolf.id],
    },
    {
      id: "dungeon.blackfang.wave2",
      name: "王前兽潮",
      monsters: [caveBat.id, direWolf.id, direWolf.id],
    },
    {
      id: "dungeon.blackfang.wave3",
      name: "黑牙兽王",
      monsters: [blackfangAlpha.id],
    },
  ],
};

const authoredDungeons = {
  [wolfDenDungeon.id]: wolfDenDungeon,
  [blackfangSanctumDungeon.id]: blackfangSanctumDungeon,
} satisfies Record<string, AuthoringDef<DungeonDef>>;

export const dungeons = compileInheritedCollection<DungeonDef>({
  bucketName: "dungeons",
  defs: authoredDungeons,
});
