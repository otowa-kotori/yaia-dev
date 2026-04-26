import { describe, test, expect, beforeEach } from "bun:test";
import {
  ATB_REFERENCE_SELF_TURN_TICKS,
  consumeCompletedRounds,
  createAtbScheduler,
  createTurnScheduler,
  getAtbReferenceSelfTurnTicks,
  tickScheduler,
  nextActor,
  onActionResolved,
  DEFAULT_ATB_ACTION_THRESHOLD,
  DEFAULT_ATB_BASE_ENERGY_GAIN,
  DEFAULT_ATB_BASE_SPEED,
  DEFAULT_ATB_INITIAL_ENERGY_PER_SPEED,
} from "../../../src/core/combat/battle";

import { resetContent } from "../../../src/core/content";
import { loadFixtureContent, makePlayer, attrDefs } from "../../fixtures/content";
import { ATTR } from "../../../src/core/entity/attribute";

describe("ATB Scheduler", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("initial energy is f(SPD), capped below threshold", () => {
    const p1 = makePlayer({ id: "p1", speed: 40 });
    const sched = createAtbScheduler();
    nextActor(sched, [p1], { attrDefs });
    const expected = Math.min(
      DEFAULT_ATB_ACTION_THRESHOLD - 1,
      40 * DEFAULT_ATB_INITIAL_ENERGY_PER_SPEED,
    );
    expect(sched.energyByActorId["p1"]).toBe(expected);
  });

  test("higher SPD -> higher initial energy", () => {
    const slow = makePlayer({ id: "slow", speed: 20 });
    const fast = makePlayer({ id: "fast", speed: 80 });
    const sched = createAtbScheduler();
    nextActor(sched, [slow, fast], { attrDefs });
    expect(sched.energyByActorId["fast"]!).toBeGreaterThan(
      sched.energyByActorId["slow"]!,
    );
  });

  test("tickScheduler charges energy proportional to SPD", () => {
    const p1 = makePlayer({ id: "p1", speed: 80 }); // 2x base
    const sched = createAtbScheduler();
    nextActor(sched, [p1], { attrDefs });
    const before = sched.energyByActorId["p1"]!;
    tickScheduler(sched, [p1], { attrDefs });
    const after = sched.energyByActorId["p1"]!;
    const expectedGain = DEFAULT_ATB_BASE_ENERGY_GAIN * (80 / DEFAULT_ATB_BASE_SPEED);
    expect(after - before).toBe(expectedGain);
  });

  test("default ATB action threshold derives from reference self-turn ticks", () => {
    const sched = createAtbScheduler();
    expect(DEFAULT_ATB_ACTION_THRESHOLD).toBe(
      DEFAULT_ATB_BASE_ENERGY_GAIN * ATB_REFERENCE_SELF_TURN_TICKS,
    );
    expect(getAtbReferenceSelfTurnTicks(sched)).toBe(ATB_REFERENCE_SELF_TURN_TICKS);
  });



  test("nextActor returns null when no one above threshold", () => {
    const p1 = makePlayer({ id: "p1", speed: 40 });
    const sched = createAtbScheduler();
    expect(nextActor(sched, [p1], { attrDefs })).toBe(null);
  });

  test("nextActor returns the actor with highest energy above threshold", () => {
    const p1 = makePlayer({ id: "p1", speed: 40 });
    const p2 = makePlayer({ id: "p2", speed: 80 });
    const sched = createAtbScheduler();
    for (let i = 0; i < 30; i++) tickScheduler(sched, [p1, p2], { attrDefs });
    const actor = nextActor(sched, [p1, p2], { attrDefs });
    expect(actor?.id).toBe("p2");
  });

  test("onActionResolved drains energy by cost", () => {
    const p1 = makePlayer({ id: "p1", speed: 40 });
    const sched = createAtbScheduler();
    for (let i = 0; i < 30; i++) tickScheduler(sched, [p1], { attrDefs });
    const before = sched.energyByActorId["p1"]!;
    expect(before).toBeGreaterThanOrEqual(DEFAULT_ATB_ACTION_THRESHOLD);
    onActionResolved(sched, p1, 1000);
    expect(sched.energyByActorId["p1"]!).toBe(before - 1000);
  });

  test("skips dead participants", () => {
    const p1 = makePlayer({ id: "p1", speed: 40 });
    const p2 = makePlayer({ id: "p2", speed: 80 });
    p2.currentHp = 0;
    const sched = createAtbScheduler();
    for (let i = 0; i < 30; i++) tickScheduler(sched, [p1, p2], { attrDefs });
    const actor = nextActor(sched, [p1, p2], { attrDefs });
    expect(actor?.id).toBe("p1");
  });

  test("returns null when no one is alive", () => {
    const p1 = makePlayer({ id: "p1" });
    p1.currentHp = 0;
    const sched = createAtbScheduler();
    for (let i = 0; i < 30; i++) tickScheduler(sched, [p1], { attrDefs });
    expect(nextActor(sched, [p1], { attrDefs })).toBe(null);
  });

  test("ties in energy break on participant-list index (stable)", () => {
    const a = makePlayer({ id: "a", speed: 40 });
    const b = makePlayer({ id: "b", speed: 40 });
    const sched = createAtbScheduler();
    for (let i = 0; i < 30; i++) tickScheduler(sched, [a, b], { attrDefs });
    expect(nextActor(sched, [a, b], { attrDefs })?.id).toBe("a");
  });

  test("speed buff mid-combat affects energy gain immediately", () => {
    const p1 = makePlayer({ id: "p1", speed: 40 });
    const sched = createAtbScheduler();
    nextActor(sched, [p1], { attrDefs }); // init
    tickScheduler(sched, [p1], { attrDefs });
    const afterOneTick = sched.energyByActorId["p1"]!;
    p1.attrs.base[ATTR.SPEED] = 80;
    p1.attrs.cache = {};
    tickScheduler(sched, [p1], { attrDefs });
    const afterBuffTick = sched.energyByActorId["p1"]!;
    const firstGain = DEFAULT_ATB_BASE_ENERGY_GAIN * (40 / DEFAULT_ATB_BASE_SPEED);
    const buffGain = DEFAULT_ATB_BASE_ENERGY_GAIN * (80 / DEFAULT_ATB_BASE_SPEED);
    expect(afterBuffTick - afterOneTick).toBe(buffGain);
    expect(buffGain).toBe(firstGain * 2);
  });
});

describe("Turn Scheduler", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("acts immediately, then waits the configured tick interval before the next slot", () => {
    const fast = makePlayer({ id: "fast", speed: 80 });
    const slow = makePlayer({ id: "slow", speed: 40 });
    const sched = createTurnScheduler({ turnIntervalTicks: 3 });

    expect(nextActor(sched, [fast, slow], { attrDefs })?.id).toBe("fast");
    onActionResolved(sched, fast);

    expect(nextActor(sched, [fast, slow], { attrDefs })).toBe(null);
    tickScheduler(sched, [fast, slow], { attrDefs });
    expect(nextActor(sched, [fast, slow], { attrDefs })).toBe(null);
    tickScheduler(sched, [fast, slow], { attrDefs });
    expect(nextActor(sched, [fast, slow], { attrDefs })).toBe(null);
    tickScheduler(sched, [fast, slow], { attrDefs });
    expect(nextActor(sched, [fast, slow], { attrDefs })?.id).toBe("slow");
  });

  test("re-sorts remaining round actors by current SPEED after each action", () => {
    const a = makePlayer({ id: "a", speed: 50 });
    const b = makePlayer({ id: "b", speed: 70 });
    const c = makePlayer({ id: "c", speed: 40 });
    const sched = createTurnScheduler({ turnIntervalTicks: 1 });

    expect(nextActor(sched, [a, b, c], { attrDefs })?.id).toBe("b");
    onActionResolved(sched, b);

    c.attrs.base[ATTR.SPEED] = 90;
    c.attrs.cache = {};
    tickScheduler(sched, [a, b, c], { attrDefs });

    expect(nextActor(sched, [a, b, c], { attrDefs })?.id).toBe("c");
  });

  test("ties in speed break on participant-list index (stable)", () => {
    const a = makePlayer({ id: "a", speed: 50 });
    const b = makePlayer({ id: "b", speed: 50 });
    const sched = createTurnScheduler();

    expect(nextActor(sched, [a, b], { attrDefs })?.id).toBe("a");
  });

  test("new participants wait until the next round snapshot", () => {
    const a = makePlayer({ id: "a", speed: 60 });
    const b = makePlayer({ id: "b", speed: 40 });
    const c = makePlayer({ id: "c", speed: 100 });
    const sched = createTurnScheduler({ turnIntervalTicks: 1 });

    let participants = [a, b];

    expect(nextActor(sched, participants, { attrDefs })?.id).toBe("a");
    onActionResolved(sched, a);

    participants = [a, b, c] as const;
    tickScheduler(sched, participants, { attrDefs });
    expect(nextActor(sched, participants, { attrDefs })?.id).toBe("b");
    onActionResolved(sched, b);

    tickScheduler(sched, participants, { attrDefs });
    expect(nextActor(sched, participants, { attrDefs })?.id).toBe("c");
  });

  test("completed round depends on living acted actors, not original headcount", () => {
    const a = makePlayer({ id: "a", speed: 60 });
    const b = makePlayer({ id: "b", speed: 40 });
    const c = makePlayer({ id: "c", speed: 20 });
    const sched = createTurnScheduler({ turnIntervalTicks: 1 });
    const participants = [a, b, c] as const;

    expect(nextActor(sched, participants, { attrDefs })?.id).toBe("a");
    onActionResolved(sched, a);

    c.currentHp = 0;
    tickScheduler(sched, participants, { attrDefs });
    expect(nextActor(sched, participants, { attrDefs })?.id).toBe("b");
    onActionResolved(sched, b);

    tickScheduler(sched, participants, { attrDefs });
    expect(nextActor(sched, participants, { attrDefs })?.id).toBe("a");
    expect(consumeCompletedRounds(sched)).toBe(1);
  });
});

