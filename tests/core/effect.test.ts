import { describe, test, expect, beforeEach } from "bun:test";
import { applyEffect, tickActiveEffects } from "../../src/core/effect";
import { resetContent } from "../../src/core/content";
import {
  basicStrikeEffect,
  burnDotEffect,
  makeHarness,
  makeSlime,
  makePlayer,
  shieldBuffEffect,
} from "../fixtures/content";
import { ATTR } from "../../src/core/attribute";
import { getAttr } from "../../src/core/actor";

describe("effect: instant", () => {
  beforeEach(() => resetContent());

  test("damage reduces currentHp by atk - def (clamped at 1)", () => {
    const h = makeHarness();
    const attacker = makePlayer({
      id: "p1",
      abilities: [],
      atk: 15,
    });
    const defender = makeSlime("slime#1"); // def=1, hp=30

    const damage = applyEffect(basicStrikeEffect, attacker, defender, {
      state: h.state,
      bus: h.bus,
      rng: h.rng,
      attrDefs: h.attrDefs,
      currentTick: h.currentTick,
    });

    // atk 15 - def 1 = 14
    expect(damage).toBe(14);
    expect(defender.currentHp).toBe(30 - 14);
  });

  test("emits 'damage' event", () => {
    const h = makeHarness();
    const a = makePlayer({ id: "a", abilities: [], atk: 12 });
    const b = makeSlime("b");
    const received: { attackerId: string; targetId: string; amount: number }[] = [];
    h.bus.on("damage", (p) => received.push(p));
    applyEffect(basicStrikeEffect, a, b, { ...h });
    expect(received.length).toBe(1);
    expect(received[0]!.attackerId).toBe("a");
    expect(received[0]!.targetId).toBe("b");
    expect(received[0]!.amount).toBe(11);
  });

  test("currentHp is clamped to 0 on lethal damage", () => {
    const h = makeHarness();
    const a = makePlayer({ id: "a", abilities: [], atk: 9999 });
    const b = makeSlime("b");
    applyEffect(basicStrikeEffect, a, b, { ...h });
    expect(b.currentHp).toBe(0);
  });
});

describe("effect: duration", () => {
  beforeEach(() => resetContent());

  test("installing a duration effect adds modifiers and an activeEffect entry", () => {
    const h = makeHarness();
    const c = makePlayer({ id: "u", abilities: [] });

    const defBefore = getAttr(c, ATTR.DEF, h.attrDefs);
    applyEffect(shieldBuffEffect, c, c, { ...h });
    const defAfter = getAttr(c, ATTR.DEF, h.attrDefs);

    expect(c.activeEffects.length).toBe(1);
    expect(defAfter - defBefore).toBe(5);
  });

  test("tickActiveEffects removes the effect when its remaining ticks hit 0", () => {
    const h = makeHarness();
    const c = makePlayer({ id: "u", abilities: [] });
    applyEffect(shieldBuffEffect, c, c, { ...h }); // durationTicks: 10

    const ctx = {
      state: h.state,
      bus: h.bus,
      rng: h.rng,
      attrDefs: h.attrDefs,
      currentTick: h.currentTick,
    };
    for (let i = 0; i < 9; i++) tickActiveEffects(c, ctx);
    expect(c.activeEffects.length).toBe(1);
    expect(getAttr(c, ATTR.DEF, h.attrDefs)).toBe(5); // still buffed

    tickActiveEffects(c, ctx); // tick #10 expires it
    expect(c.activeEffects.length).toBe(0);
    expect(getAttr(c, ATTR.DEF, h.attrDefs)).toBe(0);
  });
});

describe("effect: periodic", () => {
  beforeEach(() => resetContent());

  test("periodic pulses fire on period boundaries", () => {
    const h = makeHarness();
    const c = makePlayer({ id: "u", abilities: [], hp: 100, maxHp: 100 });
    applyEffect(burnDotEffect, c, c, { ...h }); // duration 6, period 2, const damage 3

    const ctx = {
      state: h.state,
      bus: h.bus,
      rng: h.rng,
      attrDefs: h.attrDefs,
      currentTick: h.currentTick,
    };

    // tick 1: remaining 5 (sinceInstall=1, not divisible by 2) — no pulse
    tickActiveEffects(c, ctx);
    expect(c.currentHp).toBe(100);
    // tick 2: remaining 4 (sinceInstall=2, %2==0) — pulse for 3
    tickActiveEffects(c, ctx);
    expect(c.currentHp).toBe(97);
    // tick 3: no pulse
    tickActiveEffects(c, ctx);
    expect(c.currentHp).toBe(97);
    // tick 4: pulse
    tickActiveEffects(c, ctx);
    expect(c.currentHp).toBe(94);
    // tick 5: no pulse
    tickActiveEffects(c, ctx);
    expect(c.currentHp).toBe(94);
    // tick 6: final pulse + expires
    tickActiveEffects(c, ctx);
    expect(c.currentHp).toBe(91);
    expect(c.activeEffects.length).toBe(0);
  });
});
