import { describe, test, expect, beforeEach } from "bun:test";
import { tryUseAbility } from "../../src/core/ability";
import { resetContent } from "../../src/core/content";
import {
  basicAttackAbility,
  fireballAbility,
  makeHarness,
  makeSlime,
  makePlayer,
  shieldSelfAbility,
} from "../fixtures/content";

describe("ability: tryUseAbility", () => {
  beforeEach(() => resetContent());

  test("unknown ability returns unknown_ability", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", abilities: ["ability.does.not.exist"] });
    const target = makeSlime("m");
    const r = tryUseAbility(caster, "ability.does.not.exist", [target], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_ability");
  });

  test("ability not in caster.abilities returns not_known", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", abilities: [] });
    const target = makeSlime("m");
    const r = tryUseAbility(caster, basicAttackAbility.id, [target], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_known");
  });

  test("dead caster cannot cast", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", abilities: [basicAttackAbility.id], hp: 0 });
    const target = makeSlime("m");
    const r = tryUseAbility(caster, basicAttackAbility.id, [target], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("caster_dead");
  });

  test("successful basic attack deals damage", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", abilities: [basicAttackAbility.id], atk: 10 });
    const target = makeSlime("m"); // hp 30, def 1
    const r = tryUseAbility(caster, basicAttackAbility.id, [target], { ...h });
    expect(r.ok).toBe(true);
    expect(target.currentHp).toBe(30 - 9);
  });

  test("insufficient MP fails and does NOT consume mp or set cooldown", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", abilities: [fireballAbility.id], mp: 3 }); // fireball costs 5
    const target = makeSlime("m");
    const r = tryUseAbility(caster, fireballAbility.id, [target], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("insufficient_mp");
    expect(caster.currentMp).toBe(3);
    expect(caster.cooldowns[fireballAbility.id]).toBeUndefined();
  });

  test("successful cast deducts mp and sets cooldown", () => {
    const h = makeHarness();
    h.currentTick = 100;
    const caster = makePlayer({
      id: "p",
      abilities: [fireballAbility.id],
      mp: 10,
      atk: 12,
    });
    const target = makeSlime("m");
    const r = tryUseAbility(caster, fireballAbility.id, [target], { ...h });
    expect(r.ok).toBe(true);
    expect(caster.currentMp).toBe(5);
    expect(caster.cooldowns[fireballAbility.id]).toBe(120); // 100 + 20
  });

  test("on_cooldown rejects a cast while cd is active", () => {
    const h = makeHarness();
    h.currentTick = 100;
    const caster = makePlayer({
      id: "p",
      abilities: [fireballAbility.id],
      mp: 20,
    });
    const target = makeSlime("m");

    // First cast succeeds.
    const r1 = tryUseAbility(caster, fireballAbility.id, [target], { ...h });
    expect(r1.ok).toBe(true);

    // Immediate retry at same tick — blocked.
    const r2 = tryUseAbility(caster, fireballAbility.id, [target], { ...h });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("on_cooldown");

    // After cooldown — allowed again.
    const h2 = { ...h, currentTick: 120 };
    const r3 = tryUseAbility(caster, fireballAbility.id, [target], h2);
    expect(r3.ok).toBe(true);
  });

  test("single_enemy with same-side target is rejected", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", abilities: [basicAttackAbility.id] });
    const ally = makePlayer({ id: "ally", abilities: [] });
    const r = tryUseAbility(caster, basicAttackAbility.id, [ally], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("target_wrong_side");
  });

  test("self-target ability requires caster as sole target", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", abilities: [shieldSelfAbility.id] });
    const other = makePlayer({ id: "o", abilities: [] });

    const r1 = tryUseAbility(caster, shieldSelfAbility.id, [caster], { ...h });
    expect(r1.ok).toBe(true);

    const r2 = tryUseAbility(caster, shieldSelfAbility.id, [other], { ...h });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("wrong_target_count");
  });
});
