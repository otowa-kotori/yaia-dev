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
import { SAVE_VERSION } from "../../src/core/save/migrations";
import {
  createInventory,
  countItem,
  DEFAULT_CHAR_INVENTORY_CAPACITY,
} from "../../src/core/inventory";
import {
  attrDefs,
  forestLocation,
  forestCombatZone,
  loadFixtureContent,
  makePlayer,
  basicAttackAbility,
  waveTrophyItem,
} from "../fixtures/content";

const STAGE_ID = "test-stage";

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

function installHero(
  state: ReturnType<typeof createEmptyState>,
  hero: ReturnType<typeof makePlayer>,
): void {
  state.actors.push(hero);
  state.inventories[hero.id] = createInventory(DEFAULT_CHAR_INVENTORY_CAPACITY);
}

describe("CombatActivity + Stage integration", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("stage spawns configured waves; activity fights and awards XP plus wave loot", () => {
    const state = createEmptyState(42, SAVE_VERSION);
    const bus = createGameEventBus();
    const rng = createRng(42);

    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 20,
      speed: 20,
      maxHp: 50,
    });
    hero.locationId = forestLocation.id;
    hero.stageId = STAGE_ID;
    installHero(state, hero);

    const engine = createTickEngine();
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const controller = enterStage({
      stageId: STAGE_ID,
      locationId: forestLocation.id,
      combatZoneId: forestCombatZone.id,
      ctxProvider,
    });
    engine.register(controller);

    expect(state.stages[STAGE_ID]?.currentWave).toBeNull();
    expect(state.stages[STAGE_ID]?.pendingCombatWaveSearch).toBeNull();

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

    expect(state.stages[STAGE_ID]!.combatWaveIndex).toBeGreaterThanOrEqual(3);
    const progressed =
      hero.level > levelBefore || hero.exp > expBefore;
    expect(progressed).toBe(true);
    expect(countItem(state.inventories[hero.id]!, waveTrophyItem.id)).toBeGreaterThan(0);
  });

  test("stopRequested ends the activity cleanly", () => {
    const state = createEmptyState(42, SAVE_VERSION);
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 20,
      speed: 20,
    });
    hero.locationId = forestLocation.id;
    hero.stageId = STAGE_ID;
    installHero(state, hero);

    const engine = createTickEngine();
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const events: string[] = [];
    bus.on("activityComplete", (p) => events.push(p.kind));

    const controller = enterStage({
      stageId: STAGE_ID,
      locationId: forestLocation.id,
      combatZoneId: forestCombatZone.id,
      ctxProvider,
    });
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
    expect(engine.listTickables().some((t) => t.id === activity.id)).toBe(false);
    expect(engine.listTickables().some((t) => t.id === controller.id)).toBe(true);
  });

  test("hero KO fails the wave, gets no wave reward, then the stage advances to later waves", () => {
    const state = createEmptyState(42, SAVE_VERSION);
    const bus = createGameEventBus();
    const rng = createRng(42);

    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 0,
      def: 0,
      speed: 1,
      maxHp: 3,
    });
    hero.locationId = forestLocation.id;
    hero.stageId = STAGE_ID;
    installHero(state, hero);

    const engine = createTickEngine();
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const resolvedOutcomes: string[] = [];
    bus.on("waveResolved", (payload) => resolvedOutcomes.push(payload.outcome));

    const controller = enterStage({
      stageId: STAGE_ID,
      locationId: forestLocation.id,
      combatZoneId: forestCombatZone.id,
      ctxProvider,
    });
    engine.register(controller);

    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider,
      actionDelayTicks: 1,
      recoverHpPctPerTick: 0.5,
    });
    engine.register(activity);

    engine.step(120);

    expect(resolvedOutcomes).toContain("enemies_won");
    expect(countItem(state.inventories[hero.id]!, waveTrophyItem.id)).toBe(0);
    expect(state.stages[STAGE_ID]!.combatWaveIndex).toBeGreaterThanOrEqual(2);
    expect(["recovering", "fighting", "searchingEnemies"]).toContain(
      activity.phase,
    );
  });

  test("winning below the configured HP threshold enters recovering", () => {
    const state = createEmptyState(42, SAVE_VERSION);
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 999,
      def: 0,
      speed: 10,
      maxHp: 100,
    });
    hero.locationId = forestLocation.id;
    hero.stageId = STAGE_ID;
    installHero(state, hero);

    // Temporarily set threshold to 1 (always recover).
    const prevThreshold = forestCombatZone.recoverBelowHpFactor;
    forestCombatZone.recoverBelowHpFactor = 1;

    try {
      const engine = createTickEngine();
      const ctxProvider = makeCtxProvider(state, bus, rng, engine);
      const controller = enterStage({
        stageId: STAGE_ID,
        locationId: forestLocation.id,
        combatZoneId: forestCombatZone.id,
        ctxProvider,
      });
      engine.register(controller);

      const activity = createCombatActivity({
        ownerCharacterId: hero.id,
        ctxProvider,
        actionDelayTicks: 1,
        recoverHpPctPerTick: 0.01,
      });
      engine.register(activity);

      let won = false;
      bus.on("waveResolved", (payload) => {
        if (payload.outcome === "players_won") won = true;
      });

      for (let i = 0; i < 40 && !won; i++) {
        engine.step(1);
      }

      expect(won).toBe(true);
      expect(activity.phase).toBe("recovering");
    } finally {
      forestCombatZone.recoverBelowHpFactor = prevThreshold;
    }
  });

  test("hero fully recovers before the next wave search begins", () => {
    const state = createEmptyState(42, SAVE_VERSION);
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 999,
      def: 0,
      speed: 10,
      maxHp: 100,
    });
    hero.locationId = forestLocation.id;
    hero.stageId = STAGE_ID;
    installHero(state, hero);

    const prevThreshold = forestCombatZone.recoverBelowHpFactor;
    const prevSearchTicks = forestCombatZone.waveSearchTicks;
    forestCombatZone.recoverBelowHpFactor = 1;
    forestCombatZone.waveSearchTicks = 1;

    try {
      const engine = createTickEngine();
      const ctxProvider = makeCtxProvider(state, bus, rng, engine);
      const controller = enterStage({
        stageId: STAGE_ID,
        locationId: forestLocation.id,
        combatZoneId: forestCombatZone.id,
        ctxProvider,
      });
      engine.register(controller);

      const activity = createCombatActivity({
        ownerCharacterId: hero.id,
        ctxProvider,
        actionDelayTicks: 1,
        recoverHpPctPerTick: 0.1,
      });
      engine.register(activity);

      for (let i = 0; i < 40 && activity.phase !== "recovering"; i++) {
        engine.step(1);
      }

      expect(activity.phase).toBe("recovering");
      hero.currentHp = 10;
      expect(state.stages[STAGE_ID]!.pendingCombatWaveSearch).toBeNull();

      engine.step(1);
      expect(activity.phase).toBe("recovering");
      expect(state.stages[STAGE_ID]!.pendingCombatWaveSearch).toBeNull();

      while (activity.phase === "recovering") {
        engine.step(1);
      }

      expect(activity.phase).toBe("searchingEnemies");
      expect(state.stages[STAGE_ID]!.pendingCombatWaveSearch).toBeNull();
      expect(state.stages[STAGE_ID]!.currentWave).toBeNull();

      engine.step(1);
      expect(state.stages[STAGE_ID]!.pendingCombatWaveSearch).not.toBeNull();

    } finally {
      forestCombatZone.recoverBelowHpFactor = prevThreshold;
      forestCombatZone.waveSearchTicks = prevSearchTicks;
    }
  });

  test("leaveStage removes spawned actors", () => {
    const state = createEmptyState(42, SAVE_VERSION);
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 20,
      speed: 20,
    });
    hero.locationId = forestLocation.id;
    hero.stageId = STAGE_ID;
    installHero(state, hero);

    const engine = createTickEngine();
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const controller = enterStage({
      stageId: STAGE_ID,
      locationId: forestLocation.id,
      combatZoneId: forestCombatZone.id,
      ctxProvider,
    });
    engine.register(controller);
    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider,
      actionDelayTicks: 1,
    });
    engine.register(activity);
    engine.step(10);
    const beforeCount = state.actors.length;
    expect(beforeCount).toBeGreaterThan(1);

    engine.unregister(controller.id);
    leaveStage(STAGE_ID, ctxProvider());

    expect(state.actors.find((a) => a.id === "hero")).toBeDefined();
    expect(state.stages[STAGE_ID]).toBeUndefined();
    expect(state.actors.filter((a) => a.kind === "enemy").length).toBe(0);
  });

  test("resolved wave enemies are cleared so state.actors stays bounded", () => {
    const state = createEmptyState(42, SAVE_VERSION);
    const bus = createGameEventBus();
    const rng = createRng(42);
    const hero = makePlayer({
      id: "hero",
      abilities: [basicAttackAbility.id],
      atk: 999,
      speed: 999,
      maxHp: 100,
    });
    hero.locationId = forestLocation.id;
    hero.stageId = STAGE_ID;
    installHero(state, hero);

    const engine = createTickEngine();
    const ctxProvider = makeCtxProvider(state, bus, rng, engine);

    const controller = enterStage({
      stageId: STAGE_ID,
      locationId: forestLocation.id,
      combatZoneId: forestCombatZone.id,
      ctxProvider,
    });
    engine.register(controller);
    const activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider,
      actionDelayTicks: 1,
    });
    engine.register(activity);

    engine.step(500);

    expect(state.stages[STAGE_ID]!.combatWaveIndex).toBeGreaterThan(5);

    const stageOwned = new Set(state.stages[STAGE_ID]!.spawnedActorIds);
    const deadInState = state.actors.filter(
      (a) =>
        a.kind === "enemy" &&
        stageOwned.has(a.id) &&
        (a as unknown as { currentHp: number }).currentHp <= 0,
    );
    expect(deadInState.length).toBeLessThanOrEqual(2);
    expect(state.stages[STAGE_ID]!.spawnedActorIds.length).toBeLessThanOrEqual(4);
  });
});
