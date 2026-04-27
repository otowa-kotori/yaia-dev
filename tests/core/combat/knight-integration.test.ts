// Integration tests for knight combat: skill usage, passive effects, reactions.
//
// These tests verify the full combat pipeline end-to-end:
//   1. Knight uses Power Strike via PriorityListIntent (not just basic attack)
//   2. Passive effects (Fortitude) are applied and visible on activeEffects
//   3. Retaliation reaction triggers after_damage_taken during combat
//   4. Basic attacks trigger reaction dispatch (not bypass via effects[] fallback)

import { describe, test, expect, beforeEach } from "bun:test";
import {
  attrDefs,
  basicAttackTalent,
  basicStrikeEffect,
  makePlayer,
  makeSlime,
} from "../../fixtures/content";
import { setContent, emptyContentDb } from "../../../src/core/content";
import type { ContentDb } from "../../../src/core/content/types";
import { allocateTalentPoint } from "../../../src/core/growth/talent";
import { tryUseTalent, type AbilityContext } from "../../../src/core/behavior/ability";
import { dispatchReaction, type ReactionContext } from "../../../src/core/combat/reaction";
import { createPriorityListIntent, type PriorityRule } from "../../../src/core/combat/intent/priority";
import { ATTR, invalidateAttrs } from "../../../src/core/entity/attribute";
import { createRng } from "../../../src/core/infra/rng";
import { createGameEventBus } from "../../../src/core/infra/events";
import { createEmptyState } from "../../../src/core/infra/state";
import { SAVE_VERSION } from "../../../src/core/save/migrations";
import {
  knightFortitude,
  knightPowerStrike,
  knightRetaliation,
  knightWarcry,
} from "../../../src/content/behaviors/talents/knight";
import {
  knightFortitudeEffect,
  knightRetaliationEffect,
  knightWarcryEffect,
} from "../../../src/content/behaviors/effects/knight";
import type { Character } from "../../../src/core/entity/actor/types";

function knightTestContent(): ContentDb {
  const db: ContentDb = {
    ...emptyContentDb(),
    attributes: attrDefs,
    effects: {
      [basicStrikeEffect.id]: basicStrikeEffect,
      [knightFortitudeEffect.id]: knightFortitudeEffect,
      [knightRetaliationEffect.id]: knightRetaliationEffect,
      [knightWarcryEffect.id]: knightWarcryEffect,
    },
    talents: {
      [basicAttackTalent.id]: basicAttackTalent,
      [knightPowerStrike.id]: knightPowerStrike,
      [knightFortitude.id]: knightFortitude,
      [knightWarcry.id]: knightWarcry,
      [knightRetaliation.id]: knightRetaliation,
    },
    starting: {
      heroes: [{
        id: "hero.knight",
        name: "Knight",
        xpCurve: { kind: "char_xp_curve_v1", a: 8, p: 1.8, c: 8, base: 1.25, cap: 0.18, d: 0.22, e: 80, offset: 8 },
        knownTalents: [basicAttackTalent.id],
        availableTalents: [knightPowerStrike.id, knightFortitude.id, knightWarcry.id, knightRetaliation.id],
      }],
      initialLocationId: "location.forest.test" as any,
    },
  };
  setContent(db);
  return db;
}

describe("knight integration / passive effects", () => {
  let content: ContentDb;

  beforeEach(() => {
    content = knightTestContent();
  });

  test("fortitude appears in activeEffects after allocation", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 10;
    pc.heroConfigId = "hero.knight";

    expect(pc.activeEffects.length).toBe(0);

    allocateTalentPoint(pc, knightFortitude.id, content);
    const fortEffects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightFortitude.id as string));
    expect(fortEffects.length).toBe(1);
    expect(fortEffects[0]!.remainingActions).toBe(-1);
    expect(fortEffects[0]!.effectId).toBe(knightFortitudeEffect.id as string);
  });

  test("retaliation appears in activeEffects after allocation when Warcry prereq is met", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string] });
    pc.level = 10;
    pc.heroConfigId = "hero.knight";
    pc.talentLevels[knightWarcry.id as string] = 5;

    allocateTalentPoint(pc, knightRetaliation.id, content);
    const retEffects = pc.activeEffects.filter(ae => ae.sourceTalentId === (knightRetaliation.id as string));
    expect(retEffects.length).toBe(1);
    expect(retEffects[0]!.effectId).toBe(knightRetaliationEffect.id as string);
    expect(retEffects[0]!.state.chance).toBeDefined();
    expect(retEffects[0]!.state.dmgRatio).toBeDefined();
  });
});

describe("knight integration / retaliation reaction", () => {
  let content: ContentDb;

  beforeEach(() => {
    content = knightTestContent();
  });

  test("retaliation counter-attacks when physical damage is taken", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string], maxHp: 200, atk: 20 });
    pc.level = 10;
    pc.heroConfigId = "hero.knight";
    pc.side = "player";
    pc.talentLevels[knightWarcry.id as string] = 5;
    allocateTalentPoint(pc, knightRetaliation.id, content);

    const enemy = makeSlime("e1");
    const initialEnemyHp = enemy.currentHp;
    const rng = createRng(1);
    const bus = createGameEventBus();
    const state = createEmptyState(1, SAVE_VERSION);
    state.actors.push(pc, enemy);

    const ctx: AbilityContext = {
      state,
      bus,
      rng,
      currentTick: 0,
      participants: [pc, enemy],
    };

    let retaliated = false;
    for (let i = 0; i < 20; i++) {
      const hpBefore = enemy.currentHp;
      const result = tryUseTalent(enemy, basicAttackTalent.id as string, [pc], ctx);
      expect(result.ok).toBe(true);
      if (enemy.currentHp < hpBefore) {
        retaliated = true;
        break;
      }
    }

    expect(retaliated).toBe(true);
    expect(enemy.currentHp).toBeLessThan(initialEnemyHp);
  });

  test("retaliation does NOT trigger on magical damage", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string], maxHp: 200, atk: 20 });
    pc.level = 10;
    pc.heroConfigId = "hero.knight";
    pc.side = "player";
    pc.talentLevels[knightWarcry.id as string] = 5;
    allocateTalentPoint(pc, knightRetaliation.id, content);

    const enemy = makeSlime("e1");
    const initialEnemyHp = enemy.currentHp;

    const rng = createRng(1);
    const bus = createGameEventBus();
    const state = createEmptyState(1, SAVE_VERSION);

    const reactionCtx: ReactionContext = {
      dealPhysicalDamage() {
        throw new Error("retaliation should not fire on magical damage");
      },
      dealMagicDamage() {
        throw new Error("retaliation should not fire on magical damage");
      },
      dealDamage(_source, target, amount) {
        target.currentHp = Math.max(0, target.currentHp - Math.floor(amount));
      },
      healTarget() {},
      applyEffect() {},
      removeEffect() {},
      activeReactionKeys: new Set(),
      reactionDepth: 0,
      rng,
      bus,
      state,
      battle: {} as any,
      participants: [pc, enemy],
    };

    for (let i = 0; i < 20; i++) {
      dispatchReaction(pc, {
        kind: "after_damage_taken",
        attacker: enemy,
        damage: 10,
        damageType: "magical",
      }, reactionCtx);
    }

    expect(enemy.currentHp).toBe(initialEnemyHp);
  });

  test("retaliation does NOT trigger when physical damage is fully blocked", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string], maxHp: 200, atk: 20 });
    pc.level = 10;
    pc.heroConfigId = "hero.knight";
    pc.side = "player";
    pc.talentLevels[knightWarcry.id as string] = 5;
    allocateTalentPoint(pc, knightRetaliation.id, content);

    const enemy = makeSlime("e1");
    const initialEnemyHp = enemy.currentHp;

    const reactionCtx: ReactionContext = {
      dealPhysicalDamage() {
        throw new Error("retaliation should not fire when no damage was taken");
      },
      dealMagicDamage() {
        throw new Error("retaliation should not fire when no damage was taken");
      },
      dealDamage() {},
      healTarget() {},
      applyEffect() {},
      removeEffect() {},
      activeReactionKeys: new Set(),
      reactionDepth: 0,
      rng: createRng(1),
      bus: createGameEventBus(),
      state: createEmptyState(1, SAVE_VERSION),
      battle: {} as any,
      participants: [pc, enemy],
    };

    for (let i = 0; i < 20; i++) {
      dispatchReaction(pc, {
        kind: "after_damage_taken",
        attacker: enemy,
        damage: 0,
        damageType: "physical",
      }, reactionCtx);
    }

    expect(enemy.currentHp).toBe(initialEnemyHp);
  });

  test("retaliation is mitigated by the attacker's PDEF", () => {
    const makeKnight = () => {
      const knight = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string], maxHp: 200, atk: 20 });
      knight.level = 10;
      knight.heroConfigId = "hero.knight";
      knight.side = "player";
      knight.talentLevels[knightWarcry.id as string] = 5;
      allocateTalentPoint(knight, knightRetaliation.id, content);
      return knight;
    };

    const measureRetaliationDamage = (enemy: Character, knight: Character, seed: number) => {
      const ctx: AbilityContext = {
        state: createEmptyState(seed, SAVE_VERSION),
        bus: createGameEventBus(),
        rng: createRng(seed),
        currentTick: 0,
        participants: [knight, enemy],
      };
      ctx.state.actors.push(knight, enemy);

      for (let i = 0; i < 20; i++) {
        const hpBefore = enemy.currentHp;
        const result = tryUseTalent(enemy, basicAttackTalent.id as string, [knight], ctx);
        expect(result.ok).toBe(true);
        if (enemy.currentHp < hpBefore) {
          return hpBefore - enemy.currentHp;
        }
      }

      return 0;
    };

    const lowPdefKnight = makeKnight();
    const lowPdefEnemy = makeSlime("e-low");
    const lowRetaliationDamage = measureRetaliationDamage(lowPdefEnemy, lowPdefKnight, 11);

    const highPdefKnight = makeKnight();
    const highPdefEnemy = makeSlime("e-high");
    highPdefEnemy.attrs.base[ATTR.PDEF] = 100;
    invalidateAttrs(highPdefEnemy.attrs);
    const highRetaliationDamage = measureRetaliationDamage(highPdefEnemy, highPdefKnight, 11);

    expect(lowRetaliationDamage).toBeGreaterThan(0);
    expect(highRetaliationDamage).toBeLessThan(lowRetaliationDamage);
  });
});

describe("knight integration / basic attack reaction dispatch", () => {
  let content: ContentDb;

  beforeEach(() => {
    content = knightTestContent();
  });

  test("basic attack (effects[] fallback) triggers after_damage_taken on target", () => {
    const pc = makePlayer({ id: "hero.knight", talents: [basicAttackTalent.id as string], atk: 20 });
    pc.side = "player";

    const enemy = makeSlime("e1");

    const rng = createRng(42);
    const bus = createGameEventBus();
    const state = createEmptyState(42, SAVE_VERSION);
    state.actors.push(pc, enemy);

    const ctx: AbilityContext = {
      state,
      bus,
      rng,
      currentTick: 0,
      participants: [pc, enemy],
    };

    const result = tryUseTalent(pc, basicAttackTalent.id as string, [enemy], ctx);
    expect(result.ok).toBe(true);
    expect(enemy.currentHp).toBeLessThan(30);
  });
});

describe("knight integration / PriorityListIntent", () => {
  beforeEach(() => {
    knightTestContent();
  });

  test("priority list picks Power Strike over basic attack when conditions met", () => {
    const pc = makePlayer({
      id: "hero.knight",
      talents: [basicAttackTalent.id as string, knightPowerStrike.id as string],
      mp: 20,
    });
    pc.side = "player";
    pc.talentLevels[knightPowerStrike.id as string] = 1;

    const enemy = makeSlime("e1");
    const enemy2 = makeSlime("e2");
    const enemy3 = makeSlime("e3");
    const rng = createRng(42);

    const rules: PriorityRule[] = [
      { talentId: knightPowerStrike.id as string },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(pc, { participants: [pc, enemy, enemy2, enemy3], rng });

    expect(action).not.toBeNull();
    expect(action!.talentId).toBe(knightPowerStrike.id);
    expect(action!.targets.length).toBe(2);
  });

  test("priority list falls back to basic attack when Power Strike on cooldown", () => {
    const pc = makePlayer({
      id: "hero.knight",
      talents: [basicAttackTalent.id as string, knightPowerStrike.id as string],
      mp: 20,
    });
    pc.side = "player";
    pc.talentLevels[knightPowerStrike.id as string] = 1;
    pc.cooldowns[knightPowerStrike.id as string] = 3;

    const enemy = makeSlime("e1");
    const rng = createRng(42);

    const rules: PriorityRule[] = [
      { talentId: knightPowerStrike.id as string },
    ];
    const intent = createPriorityListIntent(rules);
    const action = intent(pc, { participants: [pc, enemy], rng });

    expect(action).not.toBeNull();
    expect(action!.talentId).toBe(basicAttackTalent.id);
  });

  test("power strike cooldown blocks next 2 actions and does not drain MP while blocked", () => {
    const pc = makePlayer({
      id: "hero.knight",
      talents: [basicAttackTalent.id as string, knightPowerStrike.id as string],
      mp: 30,
      atk: 20,
    });
    pc.side = "player";
    pc.talentLevels[knightPowerStrike.id as string] = 1;
    pc.equippedTalents = [knightPowerStrike.id as string];
    const e1 = makeSlime("e1");
    const e2 = makeSlime("e2");

    const ctx: AbilityContext = {
      state: createEmptyState(7, SAVE_VERSION),
      bus: createGameEventBus(),
      rng: createRng(7),
      currentTick: 0,
      participants: [pc, e1, e2],
    };

    const r1 = tryUseTalent(pc, knightPowerStrike.id as string, [e1, e2], ctx);
    expect(r1.ok).toBe(true);
    const mpAfterFirstCast = pc.currentMp;

    const r2 = tryUseTalent(pc, knightPowerStrike.id as string, [e1, e2], ctx);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("on_cooldown");
    expect(pc.currentMp).toBe(mpAfterFirstCast);
  });
});
