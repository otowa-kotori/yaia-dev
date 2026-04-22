import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ACTIVITY_GATHER_KIND } from "../../src/core/activity";
import { isResourceNode } from "../../src/core/actor";
import { createGameSession, type GameSession } from "../../src/core/session";
import { countItem } from "../../src/core/inventory";
import { resetContent } from "../../src/core/content";
import {
  basicAttackAbility,
  forestEncounter,
  forestLocation,
  loadFixtureContent,
  mineLocation,
  testOreItem,
  testVein,
  testXpCurve,
} from "../fixtures/content";

const liveSessions: GameSession[] = [];

function createSession(initialLocationId: string): GameSession {
  const content = loadFixtureContent();
  content.starting = {
    hero: {
      id: "hero.session",
      name: "Session Hero",
      xpCurve: testXpCurve,
      knownAbilities: [basicAttackAbility.id],
    },
    initialLocationId: initialLocationId as never,
  };

  const session = createGameSession({ content, seed: 42 });
  session.setSpeedMultiplier(0);
  session.resetToFresh();
  liveSessions.push(session);
  return session;
}

describe("GameSession location flow", () => {
  beforeEach(() => {
    resetContent();
  });

  afterEach(() => {
    while (liveSessions.length > 0) {
      liveSessions.pop()!.dispose();
    }
    resetContent();
  });

  test("stopActivity tears down the current instance but keeps the chosen location", () => {
    const session = createSession(forestLocation.id);

    session.startFight(forestEncounter.id);

    const spawnedIds = session.state.currentStage?.spawnedActorIds.slice() ?? [];
    expect(spawnedIds.length).toBeGreaterThan(0);
    expect(session.state.actors.some((a) => a.kind === "enemy")).toBe(true);

    session.stopActivity();

    expect(session.locationId).toBe(forestLocation.id);
    expect(session.activity).toBeNull();
    expect(session.state.currentStage).toBeNull();
    expect(session.state.actors.some((a) => a.kind === "enemy")).toBe(false);
    for (const actorId of spawnedIds) {
      expect(session.state.actors.find((a) => a.id === actorId)).toBeUndefined();
    }
  });

  test("startGather binds to the spawned resource-node actor and begins swinging", () => {
    const session = createSession(mineLocation.id);

    session.startGather(testVein.id);

    expect(session.activity?.kind).toBe(ACTIVITY_GATHER_KIND);
    if (!session.activity || session.activity.kind !== ACTIVITY_GATHER_KIND) {
      throw new Error("expected gather activity to be active");
    }

    const gather = session.activity;
    expect(gather.nodeId).not.toBe(testVein.id);

    const nodeActor = session.state.actors.find((a) => a.id === gather.nodeId);
    expect(nodeActor).toBeDefined();
    expect(nodeActor && isResourceNode(nodeActor)).toBe(true);

    session.engine.step(testVein.swingTicks);

    const hero = session.getHero();
    expect(hero).not.toBeNull();
    expect(gather.swingsCompleted).toBeGreaterThanOrEqual(1);
    expect(
      countItem(session.state.inventories[hero!.id]!, testOreItem.id),
    ).toBeGreaterThan(0);
  });
});
