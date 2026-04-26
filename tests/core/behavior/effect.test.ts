import { describe, test, expect, beforeEach } from "bun:test";
import { applyEffect, processActionEffects } from "../../../src/core/behavior/effect";
import { resetContent } from "../../../src/core/content";
import {
  basicStrikeEffect,
  burnDotEffect,
  makeHarness,
  makeSlime,
  makePlayer,
  shieldBuffEffect,
} from "../../fixtures/content";
import { ATTR } from "../../../src/core/entity/attribute";
import { getAttr } from "../../../src/core/entity/actor";

describe("effect: instant", () => {
  beforeEach(() => resetContent());

  test("damage reduces currentHp (phys_damage_v1: PATK=15 vs PDEF=1)", () => {
    const h = makeHarness();
    const attacker = makePlayer({
      id: "p1",
      atk: 15,
    });
    const defender = makeSlime("slime#1"); // PDEF=1, PATK=4, hp=30

    const damage = applyEffect(basicStrikeEffect, attacker, defender, {
      state: h.state,
      bus: h.bus,
      rng: h.rng,
      attrDefs: h.attrDefs,
      currentTick: h.currentTick,
    });

    // 默认 t=0.25, m=1.0
    // x = 15 / 1 = 15 → damage = floor(1 × (14 + 0.25 / 15)) = 14
    expect(damage).toBe(14);
    expect(defender.currentHp).toBe(30 - 14);
  });


  test("emits 'damage' event", () => {
    const h = makeHarness();
    const a = makePlayer({ id: "a", atk: 12 });
    const b = makeSlime("b");
    const received: { attackerId: string; targetId: string; amount: number }[] = [];
    h.bus.on("damage", (p) => received.push(p));
    applyEffect(basicStrikeEffect, a, b, { ...h });
    expect(received.length).toBe(1);
    expect(received[0]!.attackerId).toBe("a");
    expect(received[0]!.targetId).toBe("b");
    // PATK=12, PDEF=1 → x=12 → damage = floor(1 × (11 + 0.25 / 12)) = 11
    expect(received[0]!.amount).toBe(11);

  });

  test("currentHp is clamped to 0 on lethal damage", () => {
    const h = makeHarness();
    const a = makePlayer({ id: "a", atk: 9999 });
    const b = makeSlime("b");
    applyEffect(basicStrikeEffect, a, b, { ...h });
    expect(b.currentHp).toBe(0);
  });
});

describe("effect: duration", () => {
  beforeEach(() => resetContent());

  test("installing a duration effect adds modifiers and an activeEffect entry", () => {
    const h = makeHarness();
    const c = makePlayer({ id: "u" });

    const defBefore = getAttr(c, ATTR.PDEF, h.attrDefs);
    applyEffect(shieldBuffEffect, c, c, { ...h });
    const defAfter = getAttr(c, ATTR.PDEF, h.attrDefs);

    expect(c.activeEffects.length).toBe(1);
    expect(defAfter - defBefore).toBe(5);
  });

  test("processActionEffects removes the effect when its remaining actions hit 0", () => {
    const h = makeHarness();
    const c = makePlayer({ id: "u" });
    applyEffect(shieldBuffEffect, c, c, { ...h }); // durationActions: 10

    const ctx = {
      state: h.state,
      bus: h.bus,
      rng: h.rng,
      attrDefs: h.attrDefs,
      currentTick: h.currentTick,
    };
    for (let i = 0; i < 9; i++) processActionEffects(c, ctx);
    expect(c.activeEffects.length).toBe(1);
    expect(getAttr(c, ATTR.PDEF, h.attrDefs)).toBe(5); // still buffed

    processActionEffects(c, ctx); // tick #10 expires it
    expect(c.activeEffects.length).toBe(0);
    expect(getAttr(c, ATTR.PDEF, h.attrDefs)).toBe(0);
  });
});

describe("effect: periodic", () => {
  beforeEach(() => resetContent());

  test("periodic pulses fire on period boundaries", () => {
    const h = makeHarness();
    const c = makePlayer({ id: "u", hp: 100, maxHp: 100 });
    applyEffect(burnDotEffect, c, c, { ...h }); // duration 6, period 2, const damage 3

    const ctx = {
      state: h.state,
      bus: h.bus,
      rng: h.rng,
      attrDefs: h.attrDefs,
      currentTick: h.currentTick,
    };

    // tick 1: remaining 5 (sinceInstall=1, not divisible by 2) — no pulse
    processActionEffects(c, ctx);
    expect(c.currentHp).toBe(100);
    // tick 2: remaining 4 (sinceInstall=2, %2==0) — pulse for 3
    processActionEffects(c, ctx);
    expect(c.currentHp).toBe(97);
    // tick 3: no pulse
    processActionEffects(c, ctx);
    expect(c.currentHp).toBe(97);
    // tick 4: pulse
    processActionEffects(c, ctx);
    expect(c.currentHp).toBe(94);
    // tick 5: no pulse
    processActionEffects(c, ctx);
    expect(c.currentHp).toBe(94);
    // tick 6: final pulse + expires
    processActionEffects(c, ctx);
    expect(c.currentHp).toBe(91);
    expect(c.activeEffects.length).toBe(0);
  });
});
