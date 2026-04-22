import { describe, test, expect, beforeEach } from "bun:test";
import { createTickEngine } from "../../src/core/tick";
import {
  createGatherActivity,
  ACTIVITY_GATHER_KIND,
} from "../../src/core/activity";
import { enterStage } from "../../src/core/stage";
import { resetContent } from "../../src/core/content";
import { createRng } from "../../src/core/rng";
import { createGameEventBus } from "../../src/core/events";
import { createEmptyState } from "../../src/core/state";
import { SAVE_VERSION } from "../../src/core/save/migrations";
import {
  countItem,
  createInventory,
  DEFAULT_CHAR_INVENTORY_CAPACITY,
} from "../../src/core/inventory";
import { ATTR, invalidateAttrs } from "../../src/core/attribute";
import {
  attrDefs,
  loadFixtureContent,
  makePlayer,
  mineLocation,
  miningSkill,
  testOreItem,
  testVein,
} from "../fixtures/content";

const STAGE_ID = "test-gather-stage";

function setup() {
  const state = createEmptyState(42, SAVE_VERSION);
  const bus = createGameEventBus();
  const rng = createRng(42);
  const engine = createTickEngine();

  const hero = makePlayer({ id: "hero", abilities: [] });
  hero.locationId = mineLocation.id;
  hero.stageId = STAGE_ID;
  state.actors.push(hero);
  state.inventories[hero.id] = createInventory(DEFAULT_CHAR_INVENTORY_CAPACITY);

  const ctxProvider = () => ({
    state,
    bus,
    rng,
    attrDefs,
    currentTick: engine.currentTick,
  });

  const controller = enterStage({
    stageId: STAGE_ID,
    locationId: mineLocation.id,
    resourceNodes: [testVein.id],
    ctxProvider,
  });
  engine.register(controller);

  return { state, bus, rng, engine, hero, ctxProvider };
}

describe("GatherActivity + Stage", () => {
  beforeEach(() => {
    resetContent();
    loadFixtureContent();
  });

  test("stage spawns a resource node on enter", () => {
    const { state } = setup();
    const session = state.stages[STAGE_ID]!;
    expect(session.spawnedActorIds.length).toBe(1);
    const node = state.actors.find(
      (a) => a.id === session.spawnedActorIds[0],
    )!;
    expect(node.kind).toBe("resource_node");
  });

  test("gather grants XP and items per swing", () => {
    const { state, engine, hero, ctxProvider } = setup();
    const nodeId = state.stages[STAGE_ID]!.spawnedActorIds[0]!;

    const activity = createGatherActivity({
      ownerCharacterId: hero.id,
      nodeId,
      ctxProvider,
    });
    engine.register(activity);

    // testVein.swingTicks = 3 -> after 3 ticks one swing completes.
    engine.step(3);
    expect(activity.swingsCompleted).toBe(1);

    const sp = hero.skills[miningSkill.id]!;
    expect(sp.xp).toBeGreaterThan(0);

    const inv = state.inventories[hero.id]!;
    expect(countItem(inv, testOreItem.id)).toBeGreaterThan(0);
  });

  test("stopRequested halts the activity", () => {
    const { state, bus, engine, hero, ctxProvider } = setup();
    const nodeId = state.stages[STAGE_ID]!.spawnedActorIds[0]!;
    const evs: string[] = [];
    bus.on("activityComplete", (p) => evs.push(p.kind));

    const activity = createGatherActivity({
      ownerCharacterId: hero.id,
      nodeId,
      ctxProvider,
    });
    engine.register(activity);
    engine.step(2);
    activity.stopRequested = true;
    engine.step(5);

    expect(activity.stopRequested).toBe(true);
    expect(engine.listTickables().some((t) => t.id === activity.id)).toBe(
      false,
    );
  });

  test("multiple swings accumulate XP and items", () => {
    const { state, engine, hero, ctxProvider } = setup();
    const nodeId = state.stages[STAGE_ID]!.spawnedActorIds[0]!;
    const activity = createGatherActivity({
      ownerCharacterId: hero.id,
      nodeId,
      ctxProvider,
    });
    engine.register(activity);

    engine.step(30); // ~10 swings
    expect(activity.swingsCompleted).toBeGreaterThanOrEqual(8);
  });

  test("gathered items respect the player's runtime stack limit", () => {
    const { state, engine, hero, ctxProvider } = setup();
    hero.attrs.base[ATTR.INVENTORY_STACK_LIMIT] = 3;
    invalidateAttrs(hero.attrs);
    const nodeId = state.stages[STAGE_ID]!.spawnedActorIds[0]!;
    const activity = createGatherActivity({
      ownerCharacterId: hero.id,
      nodeId,
      ctxProvider,
    });
    engine.register(activity);

    engine.step(30);

    const oreStacks = state.inventories[hero.id]!.slots.filter(
      (slot) => slot?.kind === "stack" && slot.itemId === testOreItem.id,
    );
    expect(oreStacks.length).toBeGreaterThan(1);
    for (const slot of oreStacks) {
      if (!slot || slot.kind !== "stack") continue;
      expect(slot.qty).toBeLessThanOrEqual(hero.attrs.base[ATTR.INVENTORY_STACK_LIMIT]!);
    }
  });

  test("infinite yield — node stays spawned after many swings", () => {
    const { state, engine, hero, ctxProvider } = setup();
    const nodeId = state.stages[STAGE_ID]!.spawnedActorIds[0]!;
    const activity = createGatherActivity({
      ownerCharacterId: hero.id,
      nodeId,
      ctxProvider,
    });
    engine.register(activity);
    engine.step(300);

    expect(state.actors.find((a) => a.id === nodeId)).toBeDefined();
    expect(activity.swingsCompleted).toBeGreaterThan(10);
  });
});
