// Tests for the talent point allocation system.

import { describe, test, expect, beforeEach } from "bun:test";
import {
  computeTotalTp,
  computeSpentTp,
  computeAvailableTp,
  allocateTalentPoint,
} from "../../../src/core/growth/talent";
import {
  loadFixtureContent,
  makePlayer,
  attrDefs,
  basicAttackTalent,
} from "../../fixtures/content";
import { emptyContentDb, setContent } from "../../../src/core/content";
import type { ContentDb, TalentDef, TalentId } from "../../../src/core/content/types";

// ---------- Test talent defs (local to this test file) ----------

const talentA: TalentDef = {
  id: "talent.test.a" as TalentId,
  name: "Test A",
  type: "active",
  maxLevel: 5,
  tpCost: 2,
  getActiveParams: () => ({
    targetKind: "single_enemy" as const,
  }),
};

const talentB: TalentDef = {
  id: "talent.test.b" as TalentId,
  name: "Test B",
  type: "passive",
  maxLevel: 3,
  tpCost: 1,
  prereqs: [{ talentId: talentA.id, minLevel: 2 }],
};

function testContent(): ContentDb {
  const db: ContentDb = {
    ...emptyContentDb(),
    attributes: attrDefs,
    talents: {
      [basicAttackTalent.id]: basicAttackTalent,
      [talentA.id]: talentA,
      [talentB.id]: talentB,
    },
    starting: {
      heroes: [
        {
          id: "hero.test",
          name: "Test Hero",
          xpCurve: { kind: "char_xp_curve_v1", a: 8, p: 1.8, c: 8, base: 1.25, cap: 0.18, d: 0.22, e: 80, offset: 8 },
          knownTalents: [basicAttackTalent.id],
          availableTalents: [talentA.id, talentB.id],
        },
      ],
      initialLocationId: "location.forest.test" as any,
    },
  };
  setContent(db);
  return db;
}

// ---------- TP computation ----------

describe("talent / TP computation", () => {
  test("computeTotalTp returns 0 at level 1", () => {
    expect(computeTotalTp(1)).toBe(0);
  });

  test("computeTotalTp returns 3 per level above 1", () => {
    expect(computeTotalTp(2)).toBe(3);
    expect(computeTotalTp(5)).toBe(12);
    expect(computeTotalTp(11)).toBe(30);
  });

  test("computeSpentTp sums across talents", () => {
    const talents = { [talentA.id]: 3, [talentB.id]: 1 };
    // talentA: tpCost=2 × 3 = 6, talentB: tpCost=1 × 1 = 1
    expect(computeSpentTp(talents, { [talentA.id]: talentA, [talentB.id]: talentB })).toBe(7);
  });

  test("computeSpentTp ignores unknown talent ids", () => {
    const talents = { "talent.nonexistent": 5 };
    expect(computeSpentTp(talents, {})).toBe(0);
  });

  test("computeAvailableTp = total - spent", () => {
    const defs = { [talentA.id]: talentA };
    // level 5 → 12 TP total. talentA at level 2 → 4 spent. Available = 8.
    expect(computeAvailableTp(5, { [talentA.id]: 2 }, defs)).toBe(8);
  });
});

// ---------- allocateTalentPoint ----------

describe("talent / allocateTalentPoint", () => {
  let content: ContentDb;

  beforeEach(() => {
    content = testContent();
  });

  test("basic allocation succeeds", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 5; // 12 TP
    pc.heroConfigId = "hero.test";

    const result = allocateTalentPoint(pc, talentA.id, content);
    expect(result).toEqual({ ok: true, newLevel: 1 });
    expect(pc.talentLevels[talentA.id as string]).toBe(1);
  });

  test("multiple allocations increment level", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 10; // 27 TP
    pc.heroConfigId = "hero.test";

    allocateTalentPoint(pc, talentA.id, content);
    allocateTalentPoint(pc, talentA.id, content);
    allocateTalentPoint(pc, talentA.id, content);
    expect(pc.talentLevels[talentA.id as string]).toBe(3);
  });

  test("rejects unknown talent", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 5;
    pc.heroConfigId = "hero.test";

    const result = allocateTalentPoint(pc, "talent.nonexistent" as TalentId, content);
    expect(result).toEqual({ ok: false, reason: "unknown_talent" });
  });

  test("rejects when max level reached", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 30; // plenty of TP
    pc.heroConfigId = "hero.test";
    pc.talentLevels[talentA.id as string] = 5; // maxLevel = 5

    const result = allocateTalentPoint(pc, talentA.id, content);
    expect(result).toEqual({ ok: false, reason: "max_level" });
  });

  test("rejects when insufficient TP", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 2; // 3 TP total
    pc.heroConfigId = "hero.test";
    pc.talentLevels[talentA.id as string] = 1; // spent 2, 1 remaining

    // talentA costs 2 TP per level, only 1 available
    const result = allocateTalentPoint(pc, talentA.id, content);
    expect(result).toEqual({ ok: false, reason: "insufficient_tp" });
  });

  test("rejects when prerequisite not met", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 10;
    pc.heroConfigId = "hero.test";
    // talentB requires talentA at level 2, but we haven't allocated any
    const result = allocateTalentPoint(pc, talentB.id, content);
    expect(result).toEqual({ ok: false, reason: "prereq_not_met" });
  });

  test("succeeds when prerequisite is met", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 10;
    pc.heroConfigId = "hero.test";
    pc.talentLevels[talentA.id as string] = 2; // prereq met

    const result = allocateTalentPoint(pc, talentB.id, content);
    expect(result).toEqual({ ok: true, newLevel: 1 });
  });

  test("rejects talent not in hero availableTalents", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 10;
    pc.heroConfigId = "hero.test";

    // basicAttackTalent is in content.talents but NOT in hero's availableTalents
    const result = allocateTalentPoint(pc, basicAttackTalent.id, content);
    expect(result).toEqual({ ok: false, reason: "not_available" });
  });

  test("first active talent allocation adds to knownTalents", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 5;
    pc.heroConfigId = "hero.test";

    expect(pc.knownTalents.includes(talentA.id)).toBe(false);
    allocateTalentPoint(pc, talentA.id, content);
    expect(pc.knownTalents.includes(talentA.id)).toBe(true);
    expect(pc.knownTalentIds.includes(talentA.id)).toBe(true);
  });

  test("passive talent allocation does NOT add to knownTalents", () => {
    const pc = makePlayer({ id: "hero.test", talents: [basicAttackTalent.id as string] });
    pc.level = 10;
    pc.heroConfigId = "hero.test";
    pc.talentLevels[talentA.id as string] = 2; // meet prereq

    allocateTalentPoint(pc, talentB.id, content);
    // talentB is passive, should NOT appear in knownTalents
    expect(pc.knownTalents.includes(talentB.id)).toBe(false);
  });
});
