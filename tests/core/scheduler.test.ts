import { describe, test, expect, beforeEach } from "bun:test";
import { createSpeedSortedScheduler } from "../../src/core/combat";
import { resetContent } from "../../src/core/content";
import { loadFixtureContent, makePlayer, makeSlime, attrDefs } from "../fixtures/content";
import { ATTR } from "../../src/core/attribute";

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
      sched.nextActor(participants, { attrDefs }),
      sched.nextActor(participants, { attrDefs }),
      sched.nextActor(participants, { attrDefs }),
    ];
    expect(ordered.map((a) => a?.id)).toEqual(["p2", "p1", "e1"]);
  });

  test("new round is recomputed after all acted", () => {
    const p1 = makePlayer({ id: "p1", abilities: [], speed: 10 });
    const p2 = makePlayer({ id: "p2", abilities: [], speed: 20 });

    const sched = createSpeedSortedScheduler();
    const parts = [p1, p2];

    sched.nextActor(parts, { attrDefs }); // p2
    sched.nextActor(parts, { attrDefs }); // p1
    // Round 2 should recompute — a speed buff applied between rounds takes effect.
    p1.attrs.base[ATTR.SPEED] = 999;
    p1.attrs.cache = null;
    const first = sched.nextActor(parts, { attrDefs });
    expect(first?.id).toBe("p1");
  });

  test("skips dead participants", () => {
    const p1 = makePlayer({ id: "p1", abilities: [], speed: 10 });
    const p2 = makePlayer({ id: "p2", abilities: [], speed: 20 });
    p2.currentHp = 0;

    const sched = createSpeedSortedScheduler();
    const parts = [p1, p2];

    const first = sched.nextActor(parts, { attrDefs });
    expect(first?.id).toBe("p1");
  });

  test("returns null when no one is alive", () => {
    const p1 = makePlayer({ id: "p1", abilities: [] });
    p1.currentHp = 0;

    const sched = createSpeedSortedScheduler();
    expect(sched.nextActor([p1], { attrDefs })).toBe(null);
  });

  test("ties in speed break on participant-list index (stable)", () => {
    const a = makePlayer({ id: "a", abilities: [], speed: 10 });
    const b = makePlayer({ id: "b", abilities: [], speed: 10 });

    const sched = createSpeedSortedScheduler();
    const parts = [a, b];
    expect(sched.nextActor(parts, { attrDefs })?.id).toBe("a");
    expect(sched.nextActor(parts, { attrDefs })?.id).toBe("b");
  });
});
