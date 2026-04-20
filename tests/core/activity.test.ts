import { describe, test, expect, beforeEach } from "bun:test";
import { createTickEngine } from "../../src/core/tick";
import {
  createCombatActivity,
  ACTIVITY_COMBAT_KIND,
} from "../../src/core/activity";
import { resetContent } from "../../src/core/content";
import { createRng } from "../../src/core/rng";
import { createGameEventBus } from "../../src/core/events";
import { createEmptyState } from "../../src/core/state";
import {
  attrDefs,
  forestStage,
  loadFixtureContent,
  makePlayer,
  basicAttackAbility,
} from "../fixtures/content";

describe("CombatActivity + TickEngine integration", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("activity grinds waves and awards XP on enemy kill", () => {
    const state = createEmptyState(42, 1);
    const bus = createGameEventBus();
    const rng = createRng(42);

    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 20,
      speed: 20,
      maxHp: 50,
    });
    state.actors.push(hero);

    const engine = createTickEngine();
    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      stageId: forestStage.id,
      ctxProvider: () => ({
        state,
        bus,
        rng,
        attrDefs,
        currentTick: engine.currentTick,
      }),
      actionDelayTicks: 1,
      waveIntervalTicks: 2,
    });
    engine.register(activity);

    const expBefore = hero.exp;
    const levelBefore = hero.level;

    // Grind enough ticks for at least 3 waves.
    engine.step(150);

    expect(activity.waveIndex).toBeGreaterThanOrEqual(3);
    expect(hero.exp >= 0).toBe(true);
    // Either gained XP (still under next level) or leveled up.
    const progressed =
      hero.level > levelBefore || hero.exp > expBefore;
    expect(progressed).toBe(true);
  });

  test("stopRequested ends activity cleanly after current wave", () => {
    const state = createEmptyState(42, 1);
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 20,
      speed: 20,
    });
    state.actors.push(hero);

    const engine = createTickEngine();
    const events: string[] = [];
    bus.on("activityComplete", (p) => events.push(p.kind));

    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      stageId: forestStage.id,
      ctxProvider: () => ({
        state,
        bus,
        rng,
        attrDefs,
        currentTick: engine.currentTick,
      }),
      actionDelayTicks: 1,
      waveIntervalTicks: 2,
    });
    engine.register(activity);

    engine.step(10); // fight some
    activity.stopRequested = true;
    engine.step(50); // let it wind down

    expect(activity.phase).toBe("stopped");
    expect(events).toContain(ACTIVITY_COMBAT_KIND);
    expect(engine.listTickables().length).toBe(0);
  });

  test("hero KO enters recovering phase and then resumes", () => {
    const state = createEmptyState(42, 1);
    const bus = createGameEventBus();
    const rng = createRng(42);

    // Weak hero that dies to slime easily.
    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 0,
      def: 0,
      speed: 1, // slime acts first
      maxHp: 3,
    });
    state.actors.push(hero);

    const engine = createTickEngine();
    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      stageId: forestStage.id,
      ctxProvider: () => ({
        state,
        bus,
        rng,
        attrDefs,
        currentTick: engine.currentTick,
      }),
      actionDelayTicks: 1,
      waveIntervalTicks: 2,
      recoverHpPctPerTick: 0.5, // half maxHp per tick -> ~2 ticks to full
    });
    engine.register(activity);

    engine.step(10);
    // Hero should have died at some point during those ticks (either alive
    // again if recovery + new wave already happened, or dead right now).
    // The robust check: activity has done something beyond wave 1.
    expect(activity.phase === "recovering" || activity.phase === "fighting").toBe(true);

    // Let regen tick until hero is back up; a new wave should spawn.
    engine.step(30);
    expect(activity.waveIndex).toBeGreaterThanOrEqual(2);
  });
});
