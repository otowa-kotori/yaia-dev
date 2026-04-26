import type { HeroConfig, StartingConfig } from "../../core/content";
import { ATTR } from "../../core/entity/attribute";
import { compileInheritedCollection, type AuthoringDef } from "../compiler/inheritance";
import { prairieLocation } from "./locations";
import { defaultCharXpCurve } from "./formulas";
import {
  basicAttackTalent,
  knightFortitude,
  knightGuard,
  knightPowerStrike,
  knightRage,
  knightRetaliation,
  knightWarcry,
  magicBasicAttackTalent,
} from "./talents";
import {
  trainingBow,
  trainingScepter,
  trainingStaff,
  trainingSword,
} from "./items";

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
    baseAttrs: {
      [ATTR.WEAPON_MATK]: 1,
    },
  },
  "hero.knight": {
    id: "hero.knight",
    extends: "hero.template.physical",
    name: "骑士",
    availableTalents: [
      knightPowerStrike.id,
      knightFortitude.id,
      knightRetaliation.id,
      knightRage.id,
      knightGuard.id,
      knightWarcry.id,
    ],
    startingItems: [{ itemId: trainingSword.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 180,
      [ATTR.MAX_MP]: 30,
      [ATTR.STR]: 10,
      [ATTR.DEX]: 5,
      [ATTR.INT]: 3,
      [ATTR.SPEED]: 40,
    },
    growth: {
      [ATTR.MAX_HP]: 20,
      [ATTR.MAX_MP]: 2,
      [ATTR.STR]: 2.5,
      [ATTR.DEX]: 1,
    },
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  },
  "hero.ranger": {
    id: "hero.ranger",
    extends: "hero.template.physical",
    name: "游侠",
    startingItems: [{ itemId: trainingBow.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 120,
      [ATTR.MAX_MP]: 40,
      [ATTR.STR]: 6,
      [ATTR.DEX]: 10,
      [ATTR.INT]: 3,
      [ATTR.SPEED]: 50,
    },
    growth: {
      [ATTR.MAX_HP]: 14,
      [ATTR.MAX_MP]: 3,
      [ATTR.STR]: 1,
      [ATTR.DEX]: 2.5,
      [ATTR.INT]: 0,
    },
    physScaling: [{ attr: ATTR.DEX, ratio: 1.0 }],
  },
  "hero.mage": {
    id: "hero.mage",
    extends: "hero.template.magic",
    name: "法师",
    startingItems: [{ itemId: trainingStaff.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 90,
      [ATTR.MAX_MP]: 80,
      [ATTR.STR]: 3,
      [ATTR.DEX]: 4,
      [ATTR.INT]: 10,
      [ATTR.SPEED]: 40,
    },
    growth: {
      [ATTR.MAX_HP]: 10,
      [ATTR.MAX_MP]: 8,
      [ATTR.DEX]: 0.5,
      [ATTR.INT]: 2.5,
    },
  },
  "hero.cleric": {
    id: "hero.cleric",
    extends: "hero.template.magic",
    name: "圣女",
    startingItems: [{ itemId: trainingScepter.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 110,
      [ATTR.MAX_MP]: 60,
      [ATTR.STR]: 3,
      [ATTR.DEX]: 4,
      [ATTR.INT]: 8,
      [ATTR.SPEED]: 40,
      [ATTR.MRES]: 0.2,
    },
    growth: {
      [ATTR.MAX_HP]: 12,
      [ATTR.MAX_MP]: 6,
      [ATTR.DEX]: 0.5,
      [ATTR.INT]: 2,
    },
  },
} satisfies Record<string, AuthoringDef<HeroConfig>>;

export const heroConfigs = compileInheritedCollection<HeroConfig>({
  bucketName: "heroes",
  defs: authoredHeroes,
});

export const knightHero = heroConfigs["hero.knight"]!;
export const rangerHero = heroConfigs["hero.ranger"]!;
export const mageHero = heroConfigs["hero.mage"]!;
export const clericHero = heroConfigs["hero.cleric"]!;

export const startingConfig: StartingConfig = {
  heroes: [knightHero, rangerHero, mageHero, clericHero],
  initialLocationId: prairieLocation.id,
};
