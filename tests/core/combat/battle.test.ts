import { describe, test, expect, beforeEach } from "bun:test";
import {
  createAtbScheduler,
  createBattle,
  createTurnScheduler,
  tickBattle,
} from "../../../src/core/combat/battle";

import { patchContent, resetContent } from "../../../src/core/content";

import { createRng } from "../../../src/core/infra/rng";
import { createGameEventBus } from "../../../src/core/infra/events";
import { createEmptyState } from "../../../src/core/infra/state";
import type { GameState } from "../../../src/core/infra/state";
import { isAlive } from "../../../src/core/entity/actor";
import {
  basicAttackTalent,
  loadFixtureContent,
  makePlayer,
  makeSlime,
} from "../../fixtures/content";
import type { PlayerCharacter, Enemy } from "../../../src/core/entity/actor";
import type { TalentDef, TalentId } from "../../../src/core/content/types";
import { ATTR } from "../../../src/core/entity/attribute";

import { INTENT } from "../../../src/core/combat/intent";


function freshState(): GameState {
  return createEmptyState(42, 1);
}

/** Build a simple intents map using RANDOM_ATTACK for all participant IDs. */
function testIntents(...ids: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const id of ids) m[id] = INTENT.RANDOM_ATTACK;
  return m;
}

describe("Battle: tick loop", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("player kills slime in a deterministic number of ticks", () => {
    const state = freshState();
    const bus = createGameEventBus();
    const rng = createRng(42);

    const hero: PlayerCharacter = makePlayer({
      id: "p1",
      talents: [basicAttackTalent.id],
      atk: 10,
      def: 0,
      speed: 20, // acts first
      maxHp: 50,
    });
    const slime: Enemy = makeSlime("slime#1"); // hp 30, atk 4, def 1, speed 5
    state.actors = [hero, slime];

    const battle = createBattle({
      id: "b1",
      mode: "solo",
      participantIds: [hero.id, slime.id],
      startedAtTick: 0,
      intents: testIntents(hero.id, slime.id),
    });

    let tick = 0;
    const maxTicks = 500;
    while (battle.outcome === "ongoing" && tick < maxTicks) {
      tick += 1;
      tickBattle(battle, { state, bus, rng, currentTick: tick });
    }
    expect(battle.outcome).toBe("players_won");
    expect(isAlive(hero)).toBe(true);
    expect(isAlive(slime)).toBe(false);
  });

  test("same seed produces the same battle log (determinism)", () => {
    function runOnce(): string[] {
      const state = freshState();
      const bus = createGameEventBus();
      const rng = createRng(9999);
      const hero = makePlayer({
        id: "p1",
        talents: [basicAttackTalent.id],
        atk: 3,
        speed: 5, // same speed as slime -> stable tie-break on p1
        maxHp: 25,
      });
      const slime = makeSlime("s1");
      state.actors = [hero, slime];
      const b = createBattle({
        id: "b",
        mode: "solo",
        participantIds: [hero.id, slime.id],
        startedAtTick: 0,
        intents: testIntents(hero.id, slime.id),
      });
      // Collect bus events as a determinism trace.
      const trace: string[] = [];
      bus.on("damage", (ev) => trace.push(`damage:${ev.attackerId}:${ev.targetId}:${ev.amount}`));
      bus.on("battleActionStarted", (ev) => trace.push(`action:${ev.actorId}:${ev.abilityId}`));
      bus.on("battleActorDied", (ev) => trace.push(`death:${ev.victimId}`));
      bus.on("battleEnded", (ev) => trace.push(`end:${ev.outcome}`));
      let t = 0;
      while (b.outcome === "ongoing" && t < 500) {
        t += 1;
        tickBattle(b, { state, bus, rng, currentTick: t });
      }
      return trace;
    }
    expect(runOnce()).toEqual(runOnce());
  });

  test("enemies_won when hero dies", () => {
    const state = freshState();
    const bus = createGameEventBus();
    const rng = createRng(1);
    const hero = makePlayer({
      id: "p1",
      talents: [basicAttackTalent.id],
      atk: 0, // can't hurt slime (floor = 1 though... tweak def)
      def: 0,
      speed: 1,
      maxHp: 3,
    });
    const slime = makeSlime("s1"); // atk 4 > hero maxHp 3 in one swing
    state.actors = [hero, slime];
    const battle = createBattle({
      id: "b",
      mode: "solo",
      participantIds: [hero.id, slime.id],
      startedAtTick: 0,
      intents: testIntents(hero.id, slime.id),
    });
    let t = 0;
    while (battle.outcome === "ongoing" && t < 200) {
      t += 1;
      tickBattle(battle, { state, bus, rng, currentTick: t });
    }
    // Slime acts first (speed 5 > hero speed 1) and one-shots hero.
    expect(battle.outcome).toBe("enemies_won");
  });

  test("does not advance after outcome is set", () => {
    const state = freshState();
    const bus = createGameEventBus();
    const rng = createRng(1);
    const hero = makePlayer({
      id: "p1",
      talents: [basicAttackTalent.id],
      atk: 100,
      speed: 20,
    });
    const slime = makeSlime("s1");
    state.actors = [hero, slime];
    const b = createBattle({
      id: "b",
      mode: "solo",
      participantIds: [hero.id, slime.id],
      startedAtTick: 0,
      intents: testIntents(hero.id, slime.id),
    });
    // Pump enough ticks for ATB energy to trigger the one-shot action.
    for (let t = 1; t <= 50; t++) {
      tickBattle(b, { state, bus, rng, currentTick: t });
      if (b.outcome !== "ongoing") break;
    }
    expect(b.outcome).toBe("players_won");
    // Further ticks must be no-ops — no more events emitted.
    let extraEvents = 0;
    bus.on("battleActionStarted", () => extraEvents++);
    bus.on("damage", () => extraEvents++);
    bus.on("battleEnded", () => extraEvents++);
    for (let t = 2; t < 10; t++) {
      tickBattle(b, { state, bus, rng, currentTick: t });
    }
    expect(extraEvents).toBe(0);
  });

  test("ATB natural regen is spread across the reference self-turn ticks", () => {
    const state = freshState();
    const bus = createGameEventBus();
    const rng = createRng(7);
    const hero = makePlayer({
      id: "p1",
      talents: [],
      hp: 50,
      mp: 0,
      maxHp: 100,
      maxMp: 20,
      speed: 40,
    });
    hero.attrs.base[ATTR.HP_REGEN] = 25;
    hero.attrs.base[ATTR.MP_REGEN] = 25;
    hero.attrs.cache = {};

    const slime = makeSlime("s1");
    slime.knownTalentIds = [];
    state.actors = [hero, slime];

    const battle = createBattle({
      id: "b.regen.atb",
      mode: "solo",
      participantIds: [hero.id, slime.id],
      scheduler: createAtbScheduler(),
      startedAtTick: 0,
      intents: testIntents(hero.id, slime.id),
    });

    tickBattle(battle, { state, bus, rng, currentTick: 1 });

    expect(hero.currentHp).toBe(51);
    expect(hero.currentMp).toBe(1);
  });

  test("turn natural regen is granted once per completed living-actor round", () => {
    const state = freshState();
    const bus = createGameEventBus();
    const rng = createRng(8);
    const hero = makePlayer({
      id: "p1",
      talents: [],
      hp: 50,
      maxHp: 100,
      speed: 20,
    });
    hero.attrs.base[ATTR.HP_REGEN] = 5;
    hero.attrs.cache = {};

    const slime = makeSlime("s1");
    slime.knownTalentIds = [];
    state.actors = [hero, slime];

    const battle = createBattle({
      id: "b.regen.turn",
      mode: "solo",
      participantIds: [hero.id, slime.id],
      scheduler: createTurnScheduler({ turnIntervalTicks: 1 }),
      startedAtTick: 0,
      intents: testIntents(hero.id, slime.id),
    });

    tickBattle(battle, { state, bus, rng, currentTick: 1 });
    expect(hero.currentHp).toBe(50);

    tickBattle(battle, { state, bus, rng, currentTick: 2 });
    expect(hero.currentHp).toBe(50);

    tickBattle(battle, { state, bus, rng, currentTick: 3 });
    expect(hero.currentHp).toBe(55);
  });

  test("createBattle rejects participants without explicit intents", () => {

    const hero = makePlayer({
      id: "p1",
      talents: [basicAttackTalent.id],
    });
    const slime = makeSlime("s1");

    expect(() =>
      createBattle({
        id: "b",
        mode: "solo",
        participantIds: [hero.id, slime.id],
        startedAtTick: 0,
        intents: {
          [hero.id]: INTENT.RANDOM_ATTACK,
        },
      }),
    ).toThrow(`battle b: no intent registered for participant "${slime.id}"`);
  });

  test("tickBattle throws when a participant is missing from GameState", () => {
    const state = freshState();
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "p1",
      talents: [basicAttackTalent.id],
    });
    state.actors = [hero];

    const missingEnemyId = "enemy.missing";
    const battle = createBattle({
      id: "b",
      mode: "solo",
      participantIds: [hero.id, missingEnemyId],
      startedAtTick: 0,
      intents: {
        [hero.id]: INTENT.RANDOM_ATTACK,
        [missingEnemyId]: INTENT.RANDOM_ATTACK,
      },
    });

    expect(() =>
      tickBattle(battle, { state, bus, rng, currentTick: 1 }),
    ).toThrow(
      `battle b: missing participant actor "${missingEnemyId}" in GameState`,
    );
  });

  test("talent execution throw propagates correctly", () => {
    const explodingTalent: TalentDef = {
      id: "talent.test.exploding" as TalentId,
      name: "Exploding Test Talent",
      type: "active",
      maxLevel: 1,
      tpCost: 0,
      getActiveParams: () => ({
        targetKind: "single_enemy" as const,
      }),
      execute: (ctx) => {
        ctx.dealPhysicalDamage(ctx.targets[0]!, 1);
        throw new Error("boom");
      },
    };

    patchContent({
      talents: {
        [explodingTalent.id]: explodingTalent,
      },
    });

    const state = freshState();
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "p1",
      talents: [explodingTalent.id],
      atk: 10,
      speed: 100,
      maxHp: 50,
    });
    const slime = makeSlime("s1");
    state.actors = [hero, slime];

    const battle = createBattle({
      id: "b",
      mode: "solo",
      participantIds: [hero.id, slime.id],
      startedAtTick: 0,
      intents: testIntents(hero.id, slime.id),
    });

    expect(() =>
      tickBattle(battle, { state, bus, rng, currentTick: 1 }),
    ).toThrow("boom");
  });
});
