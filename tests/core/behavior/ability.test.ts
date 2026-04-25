import { describe, test, expect, beforeEach } from "bun:test";
import { tryUseTalent } from "../../../src/core/behavior/ability";
import { resetContent } from "../../../src/core/content";
import {
  basicAttackTalent,
  fireballTalent,
  makeHarness,
  makeSlime,
  makePlayer,
  shieldSelfTalent,
} from "../../fixtures/content";

describe("talent: tryUseTalent", () => {
  beforeEach(() => resetContent());

  test("unknown talent returns unknown_talent", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", talents: ["ability.does.not.exist"] });
    const target = makeSlime("m");
    const r = tryUseTalent(caster, "ability.does.not.exist", [target], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_talent");
  });

  test("talent not in caster.knownTalentIds returns not_known", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p" });
    const target = makeSlime("m");
    const r = tryUseTalent(caster, basicAttackTalent.id, [target], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_known");
  });

  test("dead caster cannot cast", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", talents: [basicAttackTalent.id], hp: 0 });
    const target = makeSlime("m");
    const r = tryUseTalent(caster, basicAttackTalent.id, [target], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("caster_dead");
  });

  test("successful basic attack deals damage", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", talents: [basicAttackTalent.id], atk: 10 });
    const target = makeSlime("m"); // hp 30, PDEF 1
    const r = tryUseTalent(caster, basicAttackTalent.id, [target], { ...h });
    expect(r.ok).toBe(true);
    // phys_damage_v1: PATK=10, PDEF=1 → excess=0 → damage=10
    expect(target.currentHp).toBe(30 - 10);
  });

  test("insufficient MP fails and does NOT consume mp or set cooldown", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", talents: [fireballTalent.id], mp: 3 }); // fireball costs 5
    const target = makeSlime("m");
    const r = tryUseTalent(caster, fireballTalent.id, [target], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("insufficient_mp");
    expect(caster.currentMp).toBe(3);
    expect(caster.cooldowns[fireballTalent.id]).toBeUndefined();
  });

  test("successful cast deducts mp and sets cooldown", () => {
    const h = makeHarness();
    h.currentTick = 100;
    const caster = makePlayer({
      id: "p",
      talents: [fireballTalent.id],
      mp: 10,
      atk: 12,
    });
    const target = makeSlime("m");
    const r = tryUseTalent(caster, fireballTalent.id, [target], { ...h });
    expect(r.ok).toBe(true);
    expect(caster.currentMp).toBe(5);
    // cooldownActions: 3 → sets remaining action count to 3
    expect(caster.cooldowns[fireballTalent.id]).toBe(3);
  });

  test("on_cooldown rejects a cast while cd is active", () => {
    const h = makeHarness();
    h.currentTick = 100;
    const caster = makePlayer({
      id: "p",
      talents: [fireballTalent.id],
      mp: 20,
    });
    const target = makeSlime("m");

    // First cast succeeds.
    const r1 = tryUseTalent(caster, fireballTalent.id, [target], { ...h });
    expect(r1.ok).toBe(true);

    // Immediate retry at same tick — blocked.
    const r2 = tryUseTalent(caster, fireballTalent.id, [target], { ...h });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("on_cooldown");

    // After cooldown expires (manually zero it out) — allowed again.
    caster.cooldowns[fireballTalent.id] = 0;
    const r3 = tryUseTalent(caster, fireballTalent.id, [target], { ...h });
    expect(r3.ok).toBe(true);
  });

  test("single_enemy with same-side target is rejected", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", talents: [basicAttackTalent.id] });
    const ally = makePlayer({ id: "ally" });
    const r = tryUseTalent(caster, basicAttackTalent.id, [ally], { ...h });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("target_wrong_side");
  });

  test("self-target talent requires caster as sole target", () => {
    const h = makeHarness();
    const caster = makePlayer({ id: "p", talents: [shieldSelfTalent.id] });
    const other = makePlayer({ id: "o" });

    const r1 = tryUseTalent(caster, shieldSelfTalent.id, [caster], { ...h });
    expect(r1.ok).toBe(true);

    const r2 = tryUseTalent(caster, shieldSelfTalent.id, [other], { ...h });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("wrong_target_count");
  });
});
