// Tests for passive talent installation and knight passive talents.

import { describe, test, expect, beforeEach } from "bun:test";
import { allocateTalentPoint } from "../../../src/core/growth/talent";
import {
  attrDefs,
  basicAttackTalent,
  makePlayer,
} from "../../fixtures/content";
import { emptyContentDb, setContent } from "../../../src/core/content";
import type { ContentDb } from "../../../src/core/content/types";
import { ATTR, getAttr as getAttrFromSet } from "../../../src/core/entity/attribute";
import {
  knightFortitude,
  knightPowerStrike,
  knightRetaliation,
  knightWarcry,
} from "../../../src/content/behaviors/talents/knight";
import {
  knightFortitudeEffect,
  knightRetaliationEffect,
  knightWarcryEffect,
} from "../../../src/content/behaviors/effects/knight";

function testContent(): ContentDb {
  const db: ContentDb = {
    ...emptyContentDb(),
    attributes: attrDefs,
    effects: {
      [knightFortitudeEffect.id]: knightFortitudeEffect,
      [knightRetaliationEffect.id]: knightRetaliationEffect,
      [knightWarcryEffect.id]: knightWarcryEffect,
    },
    talents: {
      [basicAttackTalent.id]: basicAttackTalent,
      [knightPowerStrike.id]: knightPowerStrike,
      [knightFortitude.id]: knightFortitude,
      [knightWarcry.id]: knightWarcry,
      [knightRetaliation.id]: knightRetaliation,
    },
    starting: {
      heroes: [
        {
          id: "hero.knight",
          name: "Knight",
          xpCurve: { kind: "char_xp_curve_v1", a: 8, p: 1.8, c: 8, base: 1.25, cap: 0.18, d: 0.22, e: 80, offset: 8 },
          knownTalents: [basicAttackTalent.id],
          availableTalents: [knightPowerStrike.id, knightFortitude.id, knightWarcry.id, knightRetaliation.id],
        },
      ],
      initialLocationId: "location.forest.test" as any,
    },
  };
  setContent(db);
  return db;
}

describe("passive talent / Fortitude", () => {
  let content: ContentDb;

  beforeEach(() => {
    content = testContent();
  });

  test("first allocation installs infinite EffectInstance", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 5;
    pc.heroConfigId = "hero.knight";

    const result = allocateTalentPoint(pc, knightFortitude.id, content);
    expect(result).toEqual({ ok: true, newLevel: 1 });

    const fortEffects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string));
    expect(fortEffects.length).toBe(1);
    expect(fortEffects[0]!.remainingActions).toBe(-1);
    expect(fortEffects[0]!.effectId).toBe(knightFortitudeEffect.id as string);
  });

  test("passive talent does NOT add to knownTalents", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 5;
    pc.heroConfigId = "hero.knight";

    allocateTalentPoint(pc, knightFortitude.id, content);
    expect(pc.knownTalents.includes(knightFortitude.id)).toBe(false);
  });

  test("fortitude improves max hp and regen, and both grow with level", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string], maxHp: 100 });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";

    const baseHp = getAttrFromSet(pc.attrs, ATTR.MAX_HP, attrDefs);
    const baseRegen = getAttrFromSet(pc.attrs, ATTR.HP_REGEN, attrDefs);

    allocateTalentPoint(pc, knightFortitude.id, content);
    const hpAfterLv1 = getAttrFromSet(pc.attrs, ATTR.MAX_HP, attrDefs);
    const regenAfterLv1 = getAttrFromSet(pc.attrs, ATTR.HP_REGEN, attrDefs);

    allocateTalentPoint(pc, knightFortitude.id, content);
    const hpAfterLv2 = getAttrFromSet(pc.attrs, ATTR.MAX_HP, attrDefs);
    const regenAfterLv2 = getAttrFromSet(pc.attrs, ATTR.HP_REGEN, attrDefs);

    allocateTalentPoint(pc, knightFortitude.id, content);
    const hpAfterLv3 = getAttrFromSet(pc.attrs, ATTR.MAX_HP, attrDefs);
    const regenAfterLv3 = getAttrFromSet(pc.attrs, ATTR.HP_REGEN, attrDefs);

    expect(hpAfterLv1).toBeGreaterThan(baseHp);
    expect(hpAfterLv2).toBeGreaterThan(hpAfterLv1);
    expect(hpAfterLv3).toBeGreaterThan(hpAfterLv2);

    expect(regenAfterLv1).toBeGreaterThan(baseRegen);
    expect(regenAfterLv2).toBeGreaterThan(regenAfterLv1);
    expect(regenAfterLv3).toBeGreaterThan(regenAfterLv2);
  });

  test("upgrade replaces old instance with new one (single instance, not N copies)", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";

    allocateTalentPoint(pc, knightFortitude.id, content);
    expect(pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string)).length).toBe(1);

    allocateTalentPoint(pc, knightFortitude.id, content);
    const effects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string));
    expect(effects.length).toBe(1);
    expect(effects[0]!.state.hpPct).toBeDefined();
    expect(effects[0]!.state.hpRegen).toBeDefined();

    allocateTalentPoint(pc, knightFortitude.id, content);
    const effects3 = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string));
    expect(effects3.length).toBe(1);
    expect((effects3[0]!.state.hpPct as number)).toBeGreaterThan(effects[0]!.state.hpPct as number);
    expect((effects3[0]!.state.hpRegen as number)).toBeGreaterThan(effects[0]!.state.hpRegen as number);
  });
});

describe("passive talent / Retaliation", () => {
  let content: ContentDb;

  beforeEach(() => {
    content = testContent();
  });

  test("retaliation requires Warcry Lv5 as prereq", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";

    const withoutWarcry = allocateTalentPoint(pc, knightRetaliation.id, content);
    expect(withoutWarcry).toEqual({ ok: false, reason: "prereq_not_met" });

    pc.talentLevels[knightWarcry.id as string] = 4;
    const warcryLv4 = allocateTalentPoint(pc, knightRetaliation.id, content);
    expect(warcryLv4).toEqual({ ok: false, reason: "prereq_not_met" });
  });

  test("retaliation installs single instance when prereq is met", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";
    pc.talentLevels[knightWarcry.id as string] = 5;

    allocateTalentPoint(pc, knightRetaliation.id, content);

    const retEffects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightRetaliation.id as string));
    expect(retEffects.length).toBe(1);
    expect(retEffects[0]!.state.chance).toBeDefined();
    expect(retEffects[0]!.state.dmgRatio).toBeDefined();
    expect(retEffects[0]!.remainingActions).toBe(-1);
  });

  test("retaliation upgrade keeps one instance and only damage ratio grows", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";
    pc.talentLevels[knightWarcry.id as string] = 5;

    allocateTalentPoint(pc, knightRetaliation.id, content);
    const level1 = pc.activeEffects.find(ae => ae.sourceTalentId === (knightRetaliation.id as string));
    const level1Chance = level1!.state.chance as number;
    const level1Ratio = level1!.state.dmgRatio as number;

    allocateTalentPoint(pc, knightRetaliation.id, content);

    const retEffects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightRetaliation.id as string));
    expect(retEffects.length).toBe(1);
    expect((retEffects[0]!.state.chance as number)).toBe(level1Chance);
    expect((retEffects[0]!.state.dmgRatio as number)).toBeGreaterThan(level1Ratio);
  });
});

describe("talent / describe", () => {
  test("power strike describe changes across levels and includes mp cost", () => {
    const lv1 = knightPowerStrike.describe!({ level: 1 });
    const lv3 = knightPowerStrike.describe!({ level: 3 });

    expect(lv1).toContain("伤害系数");
    expect(lv1).toContain("MP 消耗");
    expect(lv3).toContain("伤害系数");
    expect(lv3).toContain("MP 消耗");
    expect(lv3).not.toBe(lv1);
    expect(knightPowerStrike.getActiveParams!(3).mpCost).toBeGreaterThan(knightPowerStrike.getActiveParams!(1).mpCost);
  });

  test("fortitude describe reflects hp and regen identity", () => {
    const lv1 = knightFortitude.describe!({ level: 1 });
    const lv3 = knightFortitude.describe!({ level: 3 });

    expect(lv1).toContain("生命 +");
    expect(lv1).toContain("生命回复 +");
    expect(lv3).toContain("生命 +");
    expect(lv3).toContain("生命回复 +");
    expect(lv3).not.toBe(lv1);
  });

  test("retaliation describe keeps identity while higher levels improve payoff", () => {
    const lv1 = knightRetaliation.describe!({ level: 1 });
    const lv3 = knightRetaliation.describe!({ level: 3 });

    expect(lv1).toContain("反击概率");
    expect(lv1).toContain("PATK");
    expect(lv3).toContain("反击概率");
    expect(lv3).toContain("PATK");
    expect(lv3).not.toBe(lv1);
  });
});
