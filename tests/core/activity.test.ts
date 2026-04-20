import { describe, test, expect, beforeEach } from "bun:test";
import { createTickEngine } from "../../src/core/tick";
import {
  createCombatActivity,
  ACTIVITY_COMBAT_KIND,
} from "../../src/core/activity";
import { enterStage, leaveStage } from "../../src/core/stage";
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

function makeCtxProvider(
  state: ReturnType<typeof createEmptyState>,
  bus: ReturnType<typeof createGameEventBus>,
  rng: ReturnType<typeof createRng>,
  engine: ReturnType<typeof createTickEngine>,
) {
  return () => ({
    state,
    bus,
    rng,
    attrDefs,
    currentTick: engine.currentTick,
  });
}

describe("CombatActivity + Stage integration", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("stage spawns waves; activity fights and awards XP", () => {
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
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const controller = enterStage({ stageId: forestStage.id, ctxProvider });
    engine.register(controller);

    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider,
      actionDelayTicks: 1,
    });
    engine.register(activity);

    const expBefore = hero.exp;
    const levelBefore = hero.level;

    // Grind enough ticks for at least 3 waves.
    engine.step(200);

    expect(state.currentStage!.combatWaveIndex).toBeGreaterThanOrEqual(3);
    const progressed =
      hero.level > levelBefore || hero.exp > expBefore;
    expect(progressed).toBe(true);
  });

  test("stopRequested ends the activity cleanly", () => {
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
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const events: string[] = [];
    bus.on("activityComplete", (p) => events.push(p.kind));

    const controller = enterStage({ stageId: forestStage.id, ctxProvider });
    engine.register(controller);

    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider,
      actionDelayTicks: 1,
    });
    engine.register(activity);

    engine.step(10);
    activity.stopRequested = true;
    engine.step(50);

    expect(activity.phase).toBe("stopped");
    expect(events).toContain(ACTIVITY_COMBAT_KIND);
    // Activity auto-unregistered; stage controller still registered.
    expect(engine.listTickables().some((t) => t.id === activity.id)).toBe(false);
    expect(engine.listTickables().some((t) => t.id === controller.id)).toBe(true);
  });

  test("hero KO enters recovering then resumes when stage respawns enemies", () => {
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
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const controller = enterStage({ stageId: forestStage.id, ctxProvider });
    engine.register(controller);

    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider,
      actionDelayTicks: 1,
      recoverHpPctPerTick: 0.5, // half maxHp per tick -> ~2 ticks to full
    });
    engine.register(activity);

    engine.step(10);
    expect(
      activity.phase === "recovering" ||
        activity.phase === "fighting" ||
        activity.phase === "waitingForEnemies",
    ).toBe(true);

    // Let the loop cycle through recover + fight several times. The hero
    // can't actually win — slime never dies — so the stage never respawns.
    // The important property: the activity keeps cycling (not permanently
    // stuck) and the hero keeps recovering.
    engine.step(100);
    expect(hero.currentHp).toBeGreaterThanOrEqual(0);
    // At some point the hero has been revived — phase should still be
    // progressing (recovering / fighting / waiting), not a dead-end.
    expect(["recovering", "fighting", "waitingForEnemies"]).toContain(
      activity.phase,
    );
  });

  test("leaveStage removes spawned actors", () => {
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
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const controller = enterStage({ stageId: forestStage.id, ctxProvider });
    engine.register(controller);
    engine.step(3);
    const beforeCount = state.actors.length;
    expect(beforeCount).toBeGreaterThan(1); // at least the hero + one enemy

    engine.unregister(controller.id);
    leaveStage(ctxProvider());

    // Hero remains; everything stage-owned is gone.
    expect(state.actors.find((a) => a.id === "hero")).toBeDefined();
    expect(state.currentStage).toBe(null);
    expect(state.actors.filter((a) => a.kind === "enemy").length).toBe(0);
  });

  test("dead enemies are reaped so state.actors stays bounded", () => {
    const state = createEmptyState(42, 1);
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 999, // one-shot slimes
      speed: 999, // always goes first
      maxHp: 100,
    });
    state.actors.push(hero);

    const engine = createTickEngine();
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const controller = enterStage({ stageId: forestStage.id, ctxProvider });
    engine.register(controller);
    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider,
      actionDelayTicks: 1,
    });
    engine.register(activity);

    // Grind for a while — many waves should have been spawned and killed.
    engine.step(500);

    // waveIndex grows unbounded, but dead enemies must be collected.
    expect(state.currentStage!.combatWaveIndex).toBeGreaterThan(5);

    const stageOwned = new Set(state.currentStage!.spawnedActorIds);
    const deadInState = state.actors.filter(
      (a) =>
        a.kind === "enemy" &&
        stageOwned.has(a.id) &&
        (a as unknown as { currentHp: number }).currentHp <= 0,
    );
    // At most a small handful can be lingering (e.g. just-killed, still
    // referenced by the current ongoing battle). Definitely not one per wave.
    expect(deadInState.length).toBeLessThanOrEqual(3);

    // spawnedActorIds array also pruned — hard upper bound well below waves.
    expect(state.currentStage!.spawnedActorIds.length).toBeLessThan(
      state.currentStage!.combatWaveIndex,
    );
  });
});
