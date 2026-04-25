import { describe, test, expect, beforeEach } from "bun:test";
import { createBattle, tickBattle } from "../../../src/core/combat/battle";
import { resetContent } from "../../../src/core/content";
import { createRng } from "../../../src/core/infra/rng";
import { createGameEventBus } from "../../../src/core/infra/events";
import { createEmptyState } from "../../../src/core/infra/state";
import type { GameState } from "../../../src/core/infra/state";
import { isAlive } from "../../../src/core/entity/actor";
import {
  attrDefs,
  basicAttackTalent,
  loadFixtureContent,
  makePlayer,
  makeSlime,
} from "../../fixtures/content";
import type { PlayerCharacter, Enemy } from "../../../src/core/entity/actor";
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
      tickBattle(battle, { state, bus, rng, attrDefs, currentTick: tick });
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
      let t = 0;
      while (b.outcome === "ongoing" && t < 500) {
        t += 1;
        tickBattle(b, { state, bus, rng, attrDefs, currentTick: t });
      }
      return b.log.map((e) => `${e.tick}:${e.kind}:${e.actorId ?? ""}:${e.amount ?? ""}`);
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
      tickBattle(battle, { state, bus, rng, attrDefs, currentTick: t });
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
      tickBattle(b, { state, bus, rng, attrDefs, currentTick: t });
      if (b.outcome !== "ongoing") break;
    }
    expect(b.outcome).toBe("players_won");
    const logLen = b.log.length;
    // Further ticks must be no-ops.
    for (let t = 2; t < 10; t++) {
      tickBattle(b, { state, bus, rng, attrDefs, currentTick: t });
    }
    expect(b.log.length).toBe(logLen);
  });
});
