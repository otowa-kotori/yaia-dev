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
  testXpCurve,
} from "../../fixtures/content";

describe("progression / XP", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("xpCostToReach(1) is 0 (level 1 is free)", () => {
    expect(xpCostToReach(1, testXpCurve)).toBe(0);
  });

  test("xpCostToReach uses the curve", () => {
    // base 10, growth 1.2: L2 = floor(10*1.2^1) = 12,
    //                     L3 = floor(10*1.2^2) = 14 (14.4),
    //                     L4 = floor(10*1.2^3) = 17 (17.28)
    expect(xpCostToReach(2, testXpCurve)).toBe(12);
    expect(xpCostToReach(3, testXpCurve)).toBe(14);
    expect(xpCostToReach(4, testXpCurve)).toBe(17);
  });

  test("grantCharacterXp awards one level when exactly enough", () => {
    const pc = makePlayer({ id: "p", abilities: [] });
    const bus = createGameEventBus();
    const evs: { charId: string; level: number }[] = [];
    bus.on("levelup", (p) => evs.push(p));

    const gained = grantCharacterXp(pc, 12, { bus });
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

    // L1->L2 costs 12, L2->L3 costs 14, L3->L4 costs 17. 12+14+17 = 43.
    // 50 exp -> 3 levels + 7 exp left (L4->L5 costs 20, insufficient).
    const gained = grantCharacterXp(pc, 50, { bus });
    expect(gained).toBe(3);
    expect(pc.level).toBe(4);
    expect(pc.exp).toBe(7);
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

    // miningSkill uses testXpCurve: L2 costs 12. 12 exp exactly levels up.
    grantSkillXp(pc, miningSkill, 12, { bus });
    expect(evs).toEqual(["hero:skill.mining"]);
  });

  test("xpProgressToNextLevel returns pct and cost", () => {
    const pc = makePlayer({ id: "p", abilities: [] });
    pc.exp = 6;
    const p = xpProgressToNextLevel(pc.level, pc.exp, pc.xpCurve);
    expect(p.cost).toBe(12);
    expect(p.pct).toBe(0.5);
  });
});
