// Tests for passive talent installation and knight passive talents.

import { describe, test, expect, beforeEach } from "bun:test";
import {
  allocateTalentPoint,
  computeAvailableTp,
} from "../../../src/core/growth/talent";
import {
  loadFixtureContent,
  makePlayer,
  attrDefs,
  basicAttackTalent,
  makeHarness,
  makeSlime,
} from "../../fixtures/content";
import { emptyContentDb, setContent } from "../../../src/core/content";
import type { ContentDb, TalentDef, TalentId, EffectDef, EffectId } from "../../../src/core/content/types";
import { ATTR, getAttr as getAttrFromSet } from "../../../src/core/entity/attribute";
import { getAttr } from "../../../src/core/entity/actor";
import { knightFortitude, knightRetaliation, knightPowerStrike } from "../../../src/content/behaviors/talents/knight";
import { knightFortitudeEffect, knightRetaliationEffect } from "../../../src/content/behaviors/effects/knight";

// ---------- Test content setup ----------

function testContent(): ContentDb {
  const db: ContentDb = {
    ...emptyContentDb(),
    attributes: attrDefs,
    effects: {
      [knightFortitudeEffect.id]: knightFortitudeEffect,
      [knightRetaliationEffect.id]: knightRetaliationEffect,
    },
    talents: {
      [basicAttackTalent.id]: basicAttackTalent,
      [knightPowerStrike.id]: knightPowerStrike,
      [knightFortitude.id]: knightFortitude,
      [knightRetaliation.id]: knightRetaliation,
    },
    starting: {
      heroes: [
        {
          id: "hero.knight",
          name: "Knight",
          xpCurve: { kind: "char_xp_curve_v1", a: 8, p: 1.8, c: 8, base: 1.25, cap: 0.18, d: 0.22, e: 80, offset: 8 },
          knownTalents: [basicAttackTalent.id],
          availableTalents: [knightPowerStrike.id, knightFortitude.id, knightRetaliation.id],
        },
      ],
      initialLocationId: "location.forest.test" as any,
    },
  };
  setContent(db);
  return db;
}

// ---------- Passive talent installation ----------

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

    // Should have 1 copy of the fortitude effect.
    const fortEffects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string));
    expect(fortEffects.length).toBe(1);
    expect(fortEffects[0]!.remainingActions).toBe(-1); // infinite
    expect(fortEffects[0]!.effectId).toBe(knightFortitudeEffect.id as string);
  });

  test("passive talent does NOT add to knownTalents", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 5;
    pc.heroConfigId = "hero.knight";

    allocateTalentPoint(pc, knightFortitude.id, content);
    expect(pc.knownTalents.includes(knightFortitude.id)).toBe(false);
  });

  test("modifiers scale with talent level via computeModifiers", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string], maxHp: 100 });
    pc.level = 20; // plenty of TP
    pc.heroConfigId = "hero.knight";

    // Level 1: computeModifiers({level:1}) → +5% HP, +3% PDEF
    allocateTalentPoint(pc, knightFortitude.id, content);
    const hpAfterLv1 = getAttrFromSet(pc.attrs, ATTR.MAX_HP, attrDefs);
    expect(hpAfterLv1).toBe(105); // 100 * 1.05 = 105

    // Level 2: single instance replaced, computeModifiers({level:2}) → +10% HP
    allocateTalentPoint(pc, knightFortitude.id, content);
    const hpAfterLv2 = getAttrFromSet(pc.attrs, ATTR.MAX_HP, attrDefs);
    expect(hpAfterLv2).toBe(110); // 100 * 1.10 = 110

    // Level 3: computeModifiers({level:3}) → +15% HP
    allocateTalentPoint(pc, knightFortitude.id, content);
    const hpAfterLv3 = getAttrFromSet(pc.attrs, ATTR.MAX_HP, attrDefs);
    expect(hpAfterLv3).toBe(115); // 100 * 1.15 = 115
  });

  test("upgrade replaces old instance with new one (single instance, not N copies)", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";

    allocateTalentPoint(pc, knightFortitude.id, content);
    // Always exactly 1 instance regardless of level.
    expect(pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string)).length).toBe(1);

    allocateTalentPoint(pc, knightFortitude.id, content);
    // Old removed, new installed — still 1.
    const effects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string));
    expect(effects.length).toBe(1);
    expect(effects[0]!.state.level).toBe(2);

    allocateTalentPoint(pc, knightFortitude.id, content);
    const effects3 = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string));
    expect(effects3.length).toBe(1);
    expect(effects3[0]!.state.level).toBe(3);
  });
});

// ---------- Retaliation ----------

describe("passive talent / Retaliation", () => {
  let content: ContentDb;

  beforeEach(() => {
    content = testContent();
  });

  test("retaliation requires Fortitude as prereq", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";

    const result = allocateTalentPoint(pc, knightRetaliation.id, content);
    expect(result).toEqual({ ok: false, reason: "prereq_not_met" });
  });

  test("retaliation installs single instance with state.level", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";
    pc.talentLevels[knightFortitude.id as string] = 1; // prereq met

    allocateTalentPoint(pc, knightRetaliation.id, content);

    const retEffects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightRetaliation.id as string));
    expect(retEffects.length).toBe(1);
    expect(retEffects[0]!.state.level).toBe(1);
    expect(retEffects[0]!.remainingActions).toBe(-1);
  });

  test("retaliation upgrade replaces instance with new level", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 20;
    pc.heroConfigId = "hero.knight";
    pc.talentLevels[knightFortitude.id as string] = 1;

    allocateTalentPoint(pc, knightRetaliation.id, content);
    allocateTalentPoint(pc, knightRetaliation.id, content);

    const retEffects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightRetaliation.id as string));
    // Still only 1 instance (reaction-based, grantEffects returns 1 copy).
    expect(retEffects.length).toBe(1);
    expect(retEffects[0]!.state.level).toBe(2);
  });
});

// ---------- describeLevel ----------

describe("talent / describeLevel", () => {
  test("power strike describeLevel includes coefficient", () => {
    const desc = knightPowerStrike.describeLevel!(3);
    expect(desc).toContain("1.42"); // 1.3 + 3 * 0.04
  });

  test("power strike describeLevel at level 1 shows coefficient", () => {
    const desc = knightPowerStrike.describeLevel!(1);
    expect(desc).toContain("1.34");
  });

  test("fortitude describeLevel scales with level", () => {
    expect(knightFortitude.describeLevel!(1)).toContain("5%");
    expect(knightFortitude.describeLevel!(3)).toContain("15%");
    expect(knightFortitude.describeLevel!(3)).toContain("9%");
  });

  test("retaliation describeLevel scales chance and damage", () => {
    const lv1 = knightRetaliation.describeLevel!(1);
    expect(lv1).toContain("20%");
    expect(lv1).toContain("50%");
    const lv3 = knightRetaliation.describeLevel!(3);
    expect(lv3).toContain("40%");
    expect(lv3).toContain("70%");
  });
});
