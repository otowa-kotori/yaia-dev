import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetContent } from "../../../src/core/content";
import { createGameSession, type GameSession } from "../../../src/core/session";
import {
  basicAttackAbility,
  forestLocation,
  loadFixtureContent,
  testDungeon,
  testXpCurve,
  waveTrophyItem,
} from "../../fixtures/content";
import { countItem } from "../../../src/core/inventory";

const liveSessions: GameSession[] = [];

function createSession(): GameSession {
  const content = loadFixtureContent();
  content.starting = {
    heroes: [
      {
        id: "hero.1",
        name: "Fighter",
        xpCurve: testXpCurve,
        knownAbilities: [basicAttackAbility.id],
      },
      {
        id: "hero.2",
        name: "Mage",
        xpCurve: testXpCurve,
        knownAbilities: [basicAttackAbility.id],
      },
    ],
    initialLocationId: forestLocation.id as never,
  };

  const session = createGameSession({ content, seed: 42 });
  session.setSpeedMultiplier(0);
  session.resetToFresh();
  liveSessions.push(session);
  return session;
}

describe("Dungeon system", () => {
  beforeEach(() => {
    resetContent();
  });

  afterEach(() => {
    while (liveSessions.length > 0) {
      liveSessions.pop()!.dispose();
    }
    resetContent();
  });

  test("startDungeon creates a DungeonSession and binds party characters", () => {
    const session = createSession();
    session.startDungeon(testDungeon.id, ["hero.1", "hero.2"]);

    const hero1 = session.getCharacter("hero.1").hero;
    const hero2 = session.getCharacter("hero.2").hero;

    // Both heroes should have a dungeon session id.
    expect(hero1.dungeonSessionId).not.toBeNull();
    expect(hero2.dungeonSessionId).toBe(hero1.dungeonSessionId);

    // A DungeonSession should exist in state.
    const dsId = hero1.dungeonSessionId!;
    const ds = session.state.dungeons[dsId];
    expect(ds).toBeDefined();
    expect(ds!.dungeonId).toBe(testDungeon.id);
    expect(ds!.partyCharIds).toEqual(["hero.1", "hero.2"]);
    expect(ds!.status).toBe("in_progress");
    expect(ds!.currentWaveIndex).toBe(0);

    // Both heroes should share the same stage.
    expect(hero1.stageId).not.toBeNull();
    expect(hero1.stageId).toBe(hero2.stageId);
  });

  test("dungeon runs through all waves to completion", () => {
    const session = createSession();
    session.startDungeon(testDungeon.id, ["hero.1"]);

    const hero = session.getCharacter("hero.1").hero;
    const dsId = hero.dungeonSessionId!;

    // Run enough ticks for the dungeon to complete (transition + battle per wave).
    // With 2 waves, waveTransitionTicks=2, and battles should resolve quickly.
    session.engine.step(500);

    // After enough ticks the dungeon should either complete or still be fighting.
    // Let's check if it finished. If not, step more.
    let ds = session.state.dungeons[dsId];
    if (ds && ds.status === "in_progress") {
      session.engine.step(500);
      ds = session.state.dungeons[dsId];
    }

    // After completion, the dungeon session should be cleaned up.
    // The restoreParty callback deletes it.
    expect(session.state.dungeons[dsId]).toBeUndefined();

    // Hero should be restored (dungeonSessionId cleared).
    expect(hero.dungeonSessionId).toBeNull();
  });

  test("abandonDungeon terminates the run and restores characters", () => {
    const session = createSession();
    session.startDungeon(testDungeon.id, ["hero.1", "hero.2"]);

    const hero1 = session.getCharacter("hero.1").hero;
    const hero2 = session.getCharacter("hero.2").hero;
    const dsId = hero1.dungeonSessionId!;

    // Step a few ticks to get into the dungeon.
    session.engine.step(5);

    // Abandon.
    session.abandonDungeon("hero.1");

    // Both heroes should be restored.
    expect(hero1.dungeonSessionId).toBeNull();
    expect(hero2.dungeonSessionId).toBeNull();

    // Dungeon session should be cleaned up.
    expect(session.state.dungeons[dsId]).toBeUndefined();
  });

  test("startDungeon throws on empty party", () => {
    const session = createSession();
    expect(() => session.startDungeon(testDungeon.id, [])).toThrow(
      "partyCharIds must not be empty",
    );
  });

  test("startDungeon throws on invalid character id", () => {
    const session = createSession();
    expect(() =>
      session.startDungeon(testDungeon.id, ["hero.nonexistent"]),
    ).toThrow('no character "hero.nonexistent"');
  });

  test("single hero can complete a dungeon solo", () => {
    const session = createSession();
    session.startDungeon(testDungeon.id, ["hero.1"]);

    const hero = session.getCharacter("hero.1").hero;
    const dsId = hero.dungeonSessionId!;

    // Run the dungeon to completion.
    for (let i = 0; i < 20; i++) {
      session.engine.step(100);
      if (!session.state.dungeons[dsId]) break;
    }

    // Should be done.
    expect(session.state.dungeons[dsId]).toBeUndefined();
    expect(hero.dungeonSessionId).toBeNull();
  });

  test("dungeonWaveCleared event fires for each wave", () => {
    const session = createSession();
    const waveCleared: number[] = [];
    session.bus.on("dungeonWaveCleared", (p) => waveCleared.push(p.waveIndex));

    session.startDungeon(testDungeon.id, ["hero.1"]);

    // Run to completion.
    for (let i = 0; i < 20; i++) {
      session.engine.step(100);
      const hero = session.getCharacter("hero.1").hero;
      if (!hero.dungeonSessionId) break;
    }

    // Both waves should have been cleared.
    expect(waveCleared).toContain(0);
    expect(waveCleared).toContain(1);
  });

  test("dungeonCompleted event fires on successful completion", () => {
    const session = createSession();
    let completed = false;
    session.bus.on("dungeonCompleted", () => {
      completed = true;
    });

    session.startDungeon(testDungeon.id, ["hero.1"]);

    for (let i = 0; i < 20; i++) {
      session.engine.step(100);
      if (completed) break;
    }

    expect(completed).toBe(true);
  });

  test("dungeonAbandoned event fires when abandoned", () => {
    const session = createSession();
    let abandoned = false;
    session.bus.on("dungeonAbandoned", () => {
      abandoned = true;
    });

    session.startDungeon(testDungeon.id, ["hero.1"]);
    session.engine.step(5);

    session.abandonDungeon("hero.1");

    expect(abandoned).toBe(true);
  });
});
