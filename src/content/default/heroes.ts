import type { HeroConfig, StartingConfig } from "../../core/content";
import { ATTR } from "../../core/entity/attribute";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { prairieLocation } from "./locations";
import { defaultCharXpCurve } from "./formulas";
import {
  basicAttackTalent,
  magicBasicAttackTalent,
} from "./talents";
import {
  trainingSword,
  trainingSpear,
  trainingStaff,
} from "./items";

// Phase 0 英雄：三角色，验证物理/魔法前期成长线。
// 成长三围总和守恒 = 30/级。Lv1 baseAttrs = growth × 2。

const authoredHeroes = {
  "hero.template.base": {
    id: "hero.template.base",
    abstract: true,
    xpCurve: defaultCharXpCurve,
  },
  "hero.template.physical": {
    id: "hero.template.physical",
    abstract: true,
    extends: "hero.template.base",
    knownTalents: [basicAttackTalent.id],
    magScaling: [{ attr: ATTR.INT, ratio: 1.0 }],
  },
  "hero.template.magic": {
    id: "hero.template.magic",
    abstract: true,
    extends: "hero.template.base",
    knownTalents: [magicBasicAttackTalent.id],
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
    magScaling: [{ attr: ATTR.INT, ratio: 1.0 }],
  },
  "hero.satori": {
    id: "hero.satori",
    extends: "hero.template.physical",
    name: "古明地觉",
    // 全平均标准角色，可走物理或魔法路线。
    // Phase 0 默认物理路线（装备剑）。
    learnList: [],
    startingItems: [{ itemId: trainingSword.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 100,
      [ATTR.MAX_MP]: 30,
      [ATTR.STR]: 20,
      [ATTR.DEX]: 20,
      [ATTR.INT]: 20,
      [ATTR.CON]: 20,
      [ATTR.SPEED]: 40,
    },
    growth: {
      [ATTR.MAX_HP]: 20,
      [ATTR.MAX_MP]: 3,
      [ATTR.STR]: 10,
      [ATTR.DEX]: 10,
      [ATTR.INT]: 10,
      [ATTR.CON]: 10,
    },
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  },
  "hero.remilia": {
    id: "hero.remilia",
    extends: "hero.template.physical",
    name: "蕾米莉亚",
    // 高 STR + DEX 偏高的主力物攻角色。
    learnList: [],
    startingItems: [{ itemId: trainingSpear.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 96,
      [ATTR.MAX_MP]: 20,
      [ATTR.STR]: 28,
      [ATTR.DEX]: 22,
      [ATTR.INT]: 10,
      [ATTR.CON]: 18,
      [ATTR.SPEED]: 40,
    },
    growth: {
      [ATTR.MAX_HP]: 20,
      [ATTR.MAX_MP]: 2,
      [ATTR.STR]: 14,
      [ATTR.DEX]: 11,
      [ATTR.INT]: 5,
      [ATTR.CON]: 9,
    },
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  },
  "hero.patchouli": {
    id: "hero.patchouli",
    extends: "hero.template.magic",
    name: "帕秋莉",
    // 高 INT 纯法术输出。CON 和 STR 低，DEX 补回守恒。
    learnList: [],
    startingItems: [{ itemId: trainingStaff.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 82,
      [ATTR.MAX_MP]: 60,
      [ATTR.STR]: 10,
      [ATTR.DEX]: 20,
      [ATTR.INT]: 30,
      [ATTR.CON]: 14,
      [ATTR.SPEED]: 40,
      [ATTR.WEAPON_MATK]: 5,
    },
    growth: {
      [ATTR.MAX_HP]: 20,
      [ATTR.MAX_MP]: 6,
      [ATTR.STR]: 5,
      [ATTR.DEX]: 10,
      [ATTR.INT]: 15,
      [ATTR.CON]: 7,
    },
    magScaling: [{ attr: ATTR.INT, ratio: 1.0 }],
  },
} satisfies Record<string, AuthoringDef<HeroConfig>>;

export const heroConfigs = compileInheritedCollection<HeroConfig>({
  bucketName: "heroes",
  defs: authoredHeroes,
});

export const satoriHero = heroConfigs["hero.satori"]!;
export const remiliaHero = heroConfigs["hero.remilia"]!;
export const patchouliHero = heroConfigs["hero.patchouli"]!;

export const startingConfig: StartingConfig = {
  heroes: [satoriHero, remiliaHero, patchouliHero],
  initialLocationId: prairieLocation.id,
};
