import type { HeroConfig, StartingConfig } from "../../core/content";
import { ATTR } from "../../core/entity/attribute";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { applyGrowthAnchoredBaseAttrs } from "./baseline";
import { prairieLocation } from "./locations";
import { defaultCharXpCurve } from "./formulas";
import {
  basicAttackTalent,
  magicBasicAttackTalent,
} from "./talents";
import {
  trainingSword,
  trainingStaff,
} from "./items";

/** 平衡脚本专用：prepend 到 starting.heroes[0] 作 focusedCharId，吃掉任务 charXp，不影响实测角色 exp。 */
export const balanceFocusDummyHeroId = "hero.balance_dummy" as const;

// Phase 0 英雄：三角色，验证物理/魔法前期成长线。
// 约定：growth 中出现的属性若未写 baseAttrs，则 Lv1 锚点为 growth×2（与怪物 Tier0 一致）。

const authoredHeroes = {
  "hero.template.base": {
    id: "hero.template.base",
    abstract: true,
    xpCurve: defaultCharXpCurve,
    /** 无成长的字段（武器锚点、速度、抗性等）；攻防四维与 HP 走 growth×2。 */
    baseAttrs: {
      [ATTR.MAX_MP]: 30,
      [ATTR.WEAPON_ATK]: 6,
      [ATTR.WEAPON_MATK]: 5,
      [ATTR.SPEED]: 40,
      [ATTR.PDEF]: 0,
      [ATTR.MRES]: 0,
    },
    knownTalents: [basicAttackTalent.id],
  },
  "hero.satori": {
    id: "hero.satori",
    extends: "hero.template.base",
    name: "古明地觉",
    learnList: [],
    startingItems: [{ itemId: trainingSword.id, qty: 1 }],
    growth: {
      [ATTR.STR]: 10,
      [ATTR.DEX]: 10,
      [ATTR.INT]: 10,
      [ATTR.CON]: 10,
    },
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  },
  "hero.remilia": {
    id: "hero.remilia",
    extends: "hero.template.base",
    name: "蕾米莉亚",
    learnList: [],
    startingItems: [{ itemId: trainingSword.id, qty: 1 }],
    growth: {
      [ATTR.STR]: 14,
      [ATTR.DEX]: 12,
      [ATTR.INT]: 5,
      [ATTR.CON]: 9,
    },
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  },
  "hero.patchouli": {
    id: "hero.patchouli",
    extends: "hero.template.base",
    name: "帕秋莉·诺蕾姬",
    learnList: [],
    knownTalents: [magicBasicAttackTalent.id],
    startingItems: [{ itemId: trainingStaff.id, qty: 1 }],
    growth: {
      [ATTR.STR]: 6,
      [ATTR.DEX]: 10,
      [ATTR.INT]: 15,
      [ATTR.CON]: 9,
    },
    magScaling: [{ attr: ATTR.INT, ratio: 1.0 }],
  },
  [balanceFocusDummyHeroId]: {
    id: balanceFocusDummyHeroId,
    extends: "hero.template.base",
    name: "平衡模拟焦点占位",
    learnList: [],
    growth: {
      [ATTR.MAX_HP]: 5,
      [ATTR.STR]: 1,
      [ATTR.DEX]: 1,
      [ATTR.INT]: 1,
      [ATTR.CON]: 1,
    },
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  },
} satisfies Record<string, AuthoringDef<HeroConfig>>;

const compiledHeroes = compileInheritedCollection<HeroConfig>({
  bucketName: "heroes",
  defs: authoredHeroes,
});

export const heroConfigs = Object.fromEntries(
  Object.entries(compiledHeroes).map(([id, cfg]) => [id, applyGrowthAnchoredBaseAttrs(cfg)]),
) as Record<string, HeroConfig>;

export const satoriHero = heroConfigs["hero.satori"]!;
export const remiliaHero = heroConfigs["hero.remilia"]!;
export const patchouliHero = heroConfigs["hero.patchouli"]!;

export const startingConfig: StartingConfig = {
  heroes: [satoriHero, remiliaHero, patchouliHero],
  initialLocationId: prairieLocation.id,
};
