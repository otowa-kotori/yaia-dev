import { describe, test, expect, beforeEach } from "bun:test";
import {
  createSpeedSortedScheduler,
  nextActor,
} from "../../../src/core/combat/battle";
import { resetContent } from "../../../src/core/content";
import { loadFixtureContent, makePlayer, makeSlime, attrDefs } from "../../fixtures/content";
import { ATTR } from "../../../src/core/entity/attribute";

describe("SpeedSortedScheduler", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("serves alive participants in descending speed each round", () => {
    const p1 = makePlayer({ id: "p1", abilities: [], speed: 10 });
    const p2 = makePlayer({ id: "p2", abilities: [], speed: 20 });
    const e1 = makeSlime("e1"); // speed 5

    const sched = createSpeedSortedScheduler();
    const participants = [p1, p2, e1];

    const ordered = [
      nextActor(sched, participants, { attrDefs }),
      nextActor(sched, participants, { attrDefs }),
      nextActor(sched, participants, { attrDefs }),
    ];
    expect(ordered.map((a) => a?.id)).toEqual(["p2", "p1", "e1"]);
  });

  test("mid-round speed buff takes effect immediately", () => {
    const p1 = makePlayer({ id: "p1", abilities: [], speed: 10 });
    const p2 = makePlayer({ id: "p2", abilities: [], speed: 20 });

    const sched = createSpeedSortedScheduler();
    const parts = [p1, p2];

    // First pick: p2 (speed 20).
    expect(nextActor(sched, parts, { attrDefs })?.id).toBe("p2");
    // Buff p1 during round.
    p1.attrs.base[ATTR.SPEED] = 999;
    p1.attrs.cache = {};  // invalidate so getAttr re-reads the new base
    // Second pick this round: only p1 is un-acted, so it's p1 regardless.
    expect(nextActor(sched, parts, { attrDefs })?.id).toBe("p1");
  });

  test("new round is re-evaluated from the current alive/speed snapshot", () => {
    const p1 = makePlayer({ id: "p1", abilities: [], speed: 10 });
    const p2 = makePlayer({ id: "p2", abilities: [], speed: 20 });

    const sched = createSpeedSortedScheduler();
    const parts = [p1, p2];

    // Round 1: p2, then p1.
    nextActor(sched, parts, { attrDefs });
    nextActor(sched, parts, { attrDefs });

    // Buff p1 so it outspeeds p2 for round 2.
    p1.attrs.base[ATTR.SPEED] = 999;
    p1.attrs.cache = {};  // invalidate so getAttr re-reads the new base
    expect(nextActor(sched, parts, { attrDefs })?.id).toBe("p1");
  });

  test("skips dead participants", () => {
    const p1 = makePlayer({ id: "p1", abilities: [], speed: 10 });
    const p2 = makePlayer({ id: "p2", abilities: [], speed: 20 });
    p2.currentHp = 0;

    const sched = createSpeedSortedScheduler();
    const parts = [p1, p2];

    const first = nextActor(sched, parts, { attrDefs });
    expect(first?.id).toBe("p1");
  });

  test("returns null when no one is alive", () => {
    const p1 = makePlayer({ id: "p1", abilities: [] });
    p1.currentHp = 0;

    const sched = createSpeedSortedScheduler();
    expect(nextActor(sched, [p1], { attrDefs })).toBe(null);
  });

  test("ties in speed break on participant-list index (stable)", () => {
    const a = makePlayer({ id: "a", abilities: [], speed: 10 });
    const b = makePlayer({ id: "b", abilities: [], speed: 10 });

    const sched = createSpeedSortedScheduler();
    const parts = [a, b];
    expect(nextActor(sched, parts, { attrDefs })?.id).toBe("a");
    expect(nextActor(sched, parts, { attrDefs })?.id).toBe("b");
  });
});
