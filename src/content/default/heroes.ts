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
    name: "战士",
    availableTalents: [
      knightPowerStrike.id,
      knightFortitude.id,
      knightRage.id,
      knightGuard.id,
      knightWarcry.id,
      knightRetaliation.id,
    ],
    learnList: [
      { level: 1,  talentId: knightPowerStrike.id },
      { level: 3,  talentId: knightFortitude.id },
      { level: 5,  talentId: knightWarcry.id },
      { level: 8,  talentId: knightRage.id },
      { level: 12, talentId: knightGuard.id },
      { level: 15, talentId: knightRetaliation.id },
    ],
    startingItems: [{ itemId: trainingSword.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 50,
      [ATTR.MAX_MP]: 30,
      [ATTR.STR]: 20,
      [ATTR.DEX]: 14,
      [ATTR.INT]: 8,
      [ATTR.CON]: 18,
      [ATTR.SPEED]: 40,
    },
    growth: {
      [ATTR.MAX_HP]: 20,
      [ATTR.MAX_MP]: 2,
      [ATTR.STR]: 7,
      [ATTR.DEX]: 3,
      [ATTR.INT]: 1,
      [ATTR.CON]: 5,
    },
    physScaling: [{ attr: ATTR.STR, ratio: 1.0 }],
  },
  "hero.ranger": {
    id: "hero.ranger",
    extends: "hero.template.physical",
    name: "游侠",
    learnList: [],
    startingItems: [{ itemId: trainingBow.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 40,
      [ATTR.MAX_MP]: 40,
      [ATTR.STR]: 14,
      [ATTR.DEX]: 20,
      [ATTR.INT]: 8,
      [ATTR.CON]: 14,
      [ATTR.SPEED]: 50,
    },
    growth: {
      [ATTR.MAX_HP]: 15,
      [ATTR.MAX_MP]: 3,
      [ATTR.STR]: 3,
      [ATTR.DEX]: 7,
      [ATTR.INT]: 1,
      [ATTR.CON]: 4,
    },
    physScaling: [
      { attr: ATTR.DEX, ratio: 0.7 },
      { attr: ATTR.STR, ratio: 0.3 },
    ],
  },
  "hero.mage": {
    id: "hero.mage",
    extends: "hero.template.magic",
    name: "法师",
    learnList: [],
    startingItems: [{ itemId: trainingStaff.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 30,
      [ATTR.MAX_MP]: 80,
      [ATTR.STR]: 8,
      [ATTR.DEX]: 12,
      [ATTR.INT]: 20,
      [ATTR.CON]: 10,
      [ATTR.SPEED]: 40,
      [ATTR.WEAPON_MATK]: 1,
    },
    growth: {
      [ATTR.MAX_HP]: 10,
      [ATTR.MAX_MP]: 8,
      [ATTR.STR]: 1,
      [ATTR.DEX]: 3,
      [ATTR.INT]: 7,
      [ATTR.CON]: 3,
    },
  },
  "hero.cleric": {
    id: "hero.cleric",
    extends: "hero.template.magic",
    name: "牧师",
    learnList: [],
    startingItems: [{ itemId: trainingScepter.id, qty: 1 }],
    baseAttrs: {
      [ATTR.MAX_HP]: 40,
      [ATTR.MAX_MP]: 60,
      [ATTR.STR]: 10,
      [ATTR.DEX]: 12,
      [ATTR.INT]: 18,
      [ATTR.CON]: 15,
      [ATTR.SPEED]: 40,
      [ATTR.MRES]: 0.2,
      [ATTR.WEAPON_MATK]: 1,
    },
    growth: {
      [ATTR.MAX_HP]: 15,
      [ATTR.MAX_MP]: 6,
      [ATTR.STR]: 2,
      [ATTR.DEX]: 3,
      [ATTR.INT]: 6,
      [ATTR.CON]: 4,
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
