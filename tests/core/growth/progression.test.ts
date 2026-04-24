import { describe, test, expect, beforeEach } from "bun:test";
import {
  grantCharacterXp,
  grantSkillXp,
  xpCostToReach,
  xpProgressToNextLevel,
} from "../../../src/core/growth/leveling";
import { createGameEventBus } from "../../../src/core/infra/events";
import { resetContent } from "../../../src/core/content";
import {
  loadFixtureContent,
  makePlayer,
  miningSkill,
  testCharXpCurve,
  testSkillXpCurve,
} from "../../fixtures/content";

describe("progression / XP", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("xpCostToReach(1) is 0 (level 1 is free)", () => {
    expect(xpCostToReach(1, testCharXpCurve)).toBe(0);
  });

  test("xpCostToReach uses the character curve", () => {
    expect(xpCostToReach(2, testCharXpCurve)).toBe(34);
    expect(xpCostToReach(3, testCharXpCurve)).toBe(67);
    expect(xpCostToReach(4, testCharXpCurve)).toBe(115);
  });

  test("grantCharacterXp awards one level when exactly enough", () => {
    const pc = makePlayer({ id: "p", abilities: [] });
    const bus = createGameEventBus();
    const evs: { charId: string; level: number }[] = [];
    bus.on("levelup", (p) => evs.push(p));

    const gained = grantCharacterXp(pc, 34, { bus });
    expect(gained).toBe(1);
    expect(pc.level).toBe(2);
    expect(pc.exp).toBe(0);
    expect(evs).toEqual([{ charId: "p", level: 2 }]);
  });

  test("grantCharacterXp cascades multiple level-ups on one call", () => {
    const pc = makePlayer({ id: "p", abilities: [] });
    const bus = createGameEventBus();
    const evs: number[] = [];
    bus.on("levelup", (p) => evs.push(p.level));

    // L1->L2 costs 34, L2->L3 costs 67, L3->L4 costs 115. 34+67+115 = 216.
    // 250 exp -> 3 levels + 34 exp left (L4->L5 costs 183, insufficient).
    const gained = grantCharacterXp(pc, 250, { bus });
    expect(gained).toBe(3);
    expect(pc.level).toBe(4);
    expect(pc.exp).toBe(34);
    expect(evs).toEqual([2, 3, 4]);
  });

  test("grantCharacterXp stops at maxLevel", () => {
    const pc = makePlayer({ id: "p", abilities: [] });
    pc.maxLevel = 2;
    const bus = createGameEventBus();
    const gained = grantCharacterXp(pc, 9999, { bus });
    expect(gained).toBe(1);
    expect(pc.level).toBe(2);
    // Remaining exp is NOT refunded — callers decide whether to cap.
    expect(pc.exp).toBeGreaterThan(0);
  });

  test("grantSkillXp lazily creates the skill entry", () => {
    const pc = makePlayer({ id: "p", abilities: [] });
    const bus = createGameEventBus();
    expect(pc.skills[miningSkill.id]).toBeUndefined();

    grantSkillXp(pc, miningSkill, 5, { bus });
    const sp = pc.skills[miningSkill.id]!;
    expect(sp.xp).toBe(5);
    expect(sp.level).toBe(1);
  });

  test("grantSkillXp level-up emits a namespaced levelup event", () => {
    const pc = makePlayer({ id: "hero", abilities: [] });
    const bus = createGameEventBus();
    const evs: string[] = [];
    bus.on("levelup", (p) => evs.push(p.charId));

    expect(miningSkill.xpCurve).toEqual(testSkillXpCurve);
    grantSkillXp(pc, miningSkill, 34, { bus });
    expect(evs).toEqual(["hero:skill.mining"]);
  });

  test("xpProgressToNextLevel returns pct and cost", () => {
    const pc = makePlayer({ id: "p", abilities: [] });
    pc.exp = 17;
    const p = xpProgressToNextLevel(pc.level, pc.exp, pc.xpCurve);
    expect(p.cost).toBe(34);
    expect(p.pct).toBe(0.5);
  });
});
