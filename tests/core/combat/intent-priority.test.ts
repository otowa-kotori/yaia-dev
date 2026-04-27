// Tests for PriorityListIntent.

import { describe, test, expect, beforeEach } from "bun:test";
import { createPriorityListIntent, type PriorityRule } from "../../../src/core/combat/intent/priority";
import type { IntentContext } from "../../../src/core/combat/intent";
import { patchContent } from "../../../src/core/content";
import type { TalentDef, TalentId } from "../../../src/core/content/types";
import {
  basicStrikeEffect,
  loadFixtureContent,
  makePlayer,
  makeSlime,
  basicAttackTalent,
  fireballTalent,
} from "../../fixtures/content";
import { createRng, type Rng } from "../../../src/core/infra/rng";
import type { Character } from "../../../src/core/entity/actor/types";

let rng: Rng;

beforeEach(() => {
  loadFixtureContent();
  rng = createRng(42);
});

function makeCtx(participants: readonly Character[]): IntentContext {
  return { participants, rng };
}

describe("PriorityListIntent", () => {
  test("picks first matching rule", () => {
    const player = makePlayer({
      id: "p",
      talents: [basicAttackTalent.id as string, fireballTalent.id as string],
      mp: 20,
    });
    player.side = "player";
    const enemy = makeSlime("e1");

    const rules: PriorityRule[] = [
      { talentId: fireballTalent.id as string, conditions: ["off_cooldown", "has_mp"] },
      { talentId: basicAttackTalent.id as string },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(player, makeCtx([player, enemy]));

    expect(action).not.toBeNull();
    expect(action!.talentId).toBe(fireballTalent.id);
    expect(action!.targets.length).toBe(1);
    expect(action!.targets[0]!.id).toBe("e1");
  });

  test("skips rule when on cooldown", () => {
    const player = makePlayer({
      id: "p",
      talents: [basicAttackTalent.id as string, fireballTalent.id as string],
      mp: 20,
    });
    player.side = "player";
    player.cooldowns[fireballTalent.id as string] = 2; // on CD
    const enemy = makeSlime("e1");

    const rules: PriorityRule[] = [
      { talentId: fireballTalent.id as string, conditions: ["off_cooldown", "has_mp"] },
      { talentId: basicAttackTalent.id as string },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(player, makeCtx([player, enemy]));

    expect(action).not.toBeNull();
    // Should fallback to basic attack since fireball is on CD.
    expect(action!.talentId).toBe(basicAttackTalent.id);
  });

  test("skips rule when insufficient MP", () => {
    const player = makePlayer({
      id: "p",
      talents: [basicAttackTalent.id as string, fireballTalent.id as string],
      mp: 0, // no MP
    });
    player.side = "player";
    const enemy = makeSlime("e1");

    const rules: PriorityRule[] = [
      { talentId: fireballTalent.id as string, conditions: ["has_mp"] },
      { talentId: basicAttackTalent.id as string },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(player, makeCtx([player, enemy]));

    expect(action).not.toBeNull();
    expect(action!.talentId).toBe(basicAttackTalent.id);
  });

  test("falls through to basic attack when no rules match", () => {
    const player = makePlayer({
      id: "p",
      talents: [basicAttackTalent.id as string, fireballTalent.id as string],
      mp: 0,
    });
    player.side = "player";
    player.cooldowns[fireballTalent.id as string] = 5;
    const enemy = makeSlime("e1");

    // All priority rules will fail — fireball on CD with no MP.
    const rules: PriorityRule[] = [
      { talentId: fireballTalent.id as string, conditions: ["off_cooldown", "has_mp"] },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(player, makeCtx([player, enemy]));

    expect(action).not.toBeNull();
    // Fallback is first known talent → basic attack.
    expect(action!.talentId).toBe(basicAttackTalent.id);
  });

  test("lowest_hp_enemy target policy picks wounded enemy", () => {
    const player = makePlayer({ id: "p", talents: [basicAttackTalent.id as string] });
    player.side = "player";

    const e1 = makeSlime("e1");
    const e2 = makeSlime("e2");
    e2.currentHp = 5; // wounded

    const rules: PriorityRule[] = [
      { talentId: basicAttackTalent.id as string, targetPolicy: "lowest_hp_enemy" },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(player, makeCtx([player, e1, e2]));

    expect(action).not.toBeNull();
    expect(action!.targets[0]!.id).toBe("e2");
  });

  test("self target policy targets caster", () => {
    const player = makePlayer({ id: "p", talents: [basicAttackTalent.id as string] });
    player.side = "player";
    const enemy = makeSlime("e1");

    const rules: PriorityRule[] = [
      { talentId: basicAttackTalent.id as string, targetPolicy: "self" },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(player, makeCtx([player, enemy]));

    expect(action).not.toBeNull();
    expect(action!.targets[0]!).toBe(player);
  });

  test("returns null when no enemies and no talents", () => {
    const player = makePlayer({ id: "p", talents: [] });
    player.side = "player";

    const intent = createPriorityListIntent([]);
    const action = intent(player, makeCtx([player]));

    expect(action).toBeNull();
  });

  test("all_enemies rule respects maxTargets", () => {
    const cleave: TalentDef = {
      id: "talent.test.cleave" as TalentId,
      name: "Cleave",
      type: "active",
      maxLevel: 1,
      tpCost: 0,
      getActiveParams: () => ({
        targetKind: "all_enemies" as const,
        maxTargets: 2,
      }),
      effects: [basicStrikeEffect.id],
    };
    patchContent({
      talents: { [cleave.id]: cleave },
    });

    const player = makePlayer({
      id: "p",
      talents: [cleave.id as string],
      mp: 20,
    });
    player.side = "player";
    const e1 = makeSlime("e1");
    const e2 = makeSlime("e2");
    const e3 = makeSlime("e3");

    const rules: PriorityRule[] = [{ talentId: cleave.id as string }];
    const intent = createPriorityListIntent(rules);
    const action = intent(player, makeCtx([player, e1, e2, e3]));

    expect(action).not.toBeNull();
    expect(action!.targets.length).toBe(2);
  });

  test("skips unknown talent gracefully", () => {
    const player = makePlayer({ id: "p", talents: [basicAttackTalent.id as string] });
    player.side = "player";
    const enemy = makeSlime("e1");

    const rules: PriorityRule[] = [
      { talentId: "talent.nonexistent" }, // not known, not in content
      { talentId: basicAttackTalent.id as string },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(player, makeCtx([player, enemy]));

    expect(action).not.toBeNull();
    expect(action!.talentId).toBe(basicAttackTalent.id);
  });
});
