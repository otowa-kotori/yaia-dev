import { describe, test, expect, beforeEach } from "bun:test";
import { createTickEngine } from "../../src/core/tick";
import { createBattle } from "../../src/core/combat";
import { createCombatActivity } from "../../src/core/activity";
import { resetContent } from "../../src/core/content";
import { createRng } from "../../src/core/rng";
import { createGameEventBus } from "../../src/core/events";
import { createEmptyState } from "../../src/core/state";
import { isAlive } from "../../src/core/actor";
import {
  attrDefs,
  basicAttackAbility,
  loadFixtureContent,
  makePlayer,
  makeSlime,
} from "../fixtures/content";

describe("CombatActivity + TickEngine integration", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("CombatActivity drives a battle to completion and self-unregisters", () => {
    const state = createEmptyState(42, 1);
    const bus = createGameEventBus();
    const rng = createRng(42);

    const hero = makePlayer({
      id: "p1",
      abilities: [basicAttackAbility.id],
      atk: 20,
      speed: 20,
      maxHp: 50,
    });
    const slime = makeSlime("s1");
    state.actors = [hero, slime];

    const engine = createTickEngine();
    const battle = createBattle({
      id: "b",
      mode: "solo",
      participantIds: [hero.id, slime.id],
      actionDelayTicks: 1,
      startedAtTick: 0,
    });

    const events: string[] = [];
    bus.on("activityComplete", (p) => events.push(p.kind));

    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      battle,
      ctxProvider: () => ({
        state,
        bus,
        rng,
        attrDefs,
        currentTick: engine.currentTick,
      }),
    });
    engine.register(activity);

    engine.step(20);
    expect(battle.outcome).toBe("players_won");
    expect(isAlive(hero)).toBe(true);
    // Defeated slime has been removed from actors.
    expect(state.actors.find((a) => a.id === "s1")).toBeUndefined();
    // activity auto-unregistered.
    expect(engine.listTickables().length).toBe(0);
    // activityComplete event emitted.
    expect(events).toContain("activity.combat");
  });
});
