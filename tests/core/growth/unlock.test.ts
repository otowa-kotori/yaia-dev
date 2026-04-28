import { describe, expect, test } from "bun:test";
import { emptyContentDb, type UnlockDef } from "../../../src/core/content";
import { createGameSession } from "../../../src/core/session";
import { createEmptyState } from "../../../src/core/infra/state";
import { SAVE_VERSION } from "../../../src/core/save/migrations";
import {
  isUnlocked,
  listUnlocked,
  toUnlockFlagKey,
  unlock,
} from "../../../src/core/growth/unlock";
import { testCharXpCurve } from "../../fixtures/content";

describe("growth/unlock", () => {
  test("starts locked and becomes unlocked after unlock()", () => {
    const state = createEmptyState(42, SAVE_VERSION);
    const unlockId = "unlock.feature.test";

    expect(isUnlocked(state, unlockId)).toBe(false);

    const first = unlock(state, unlockId);
    expect(first.changed).toBe(true);
    expect(state.flags[toUnlockFlagKey(unlockId)]).toBe(1);
    expect(isUnlocked(state, unlockId)).toBe(true);

    const second = unlock(state, unlockId);
    expect(second.changed).toBe(false);
    expect(listUnlocked(state)).toContain(unlockId);
  });
});

describe("session unlock API", () => {
  test("throws on unknown unlockId (alpha loud failure)", () => {
    const content = emptyContentDb();
    content.starting = {
      heroes: [
        {
          id: "hero.unlock",
          name: "Unlock Hero",
          xpCurve: testCharXpCurve,
          knownTalents: [],
        },
      ],
      initialLocationId: "location.none" as never,
    };
    content.locations = {
      "location.none": {
        id: "location.none" as never,
        name: "Nowhere",
        entries: [],
      },
    };
    const knownUnlock: UnlockDef = {
      id: "unlock.feature.known" as never,
      name: "Known",
      defaultUnlocked: false,
    };
    content.unlocks = { [knownUnlock.id]: knownUnlock };

    const session = createGameSession({ content, seed: 1 });
    session.setSpeedMultiplier(0);
    session.resetToFresh();

    expect(() => session.isUnlocked("unlock.unknown")).toThrow('content: no unlock "unlock.unknown"');
    expect(() => session.unlock("unlock.unknown", "test")).toThrow('content: no unlock "unlock.unknown"');

    session.dispose();
  });

  test("emits unlocked event once and is idempotent", () => {
    const content = emptyContentDb();
    content.starting = {
      heroes: [
        {
          id: "hero.unlock",
          name: "Unlock Hero",
          xpCurve: testCharXpCurve,
          knownTalents: [],
        },
      ],
      initialLocationId: "location.none" as never,
    };
    content.locations = {
      "location.none": {
        id: "location.none" as never,
        name: "Nowhere",
        entries: [],
      },
    };
    const unlockId = "unlock.feature.once";
    content.unlocks = {
      [unlockId]: {
        id: unlockId as never,
        name: "Once",
      },
    };

    const session = createGameSession({ content, seed: 1 });
    session.setSpeedMultiplier(0);
    session.resetToFresh();

    const events: Array<{ unlockId: string; source: string; tick: number }> = [];
    const off = session.bus.on("unlocked", (payload) => {
      events.push(payload);
    });

    expect(session.isUnlocked(unlockId)).toBe(false);
    expect(session.unlock(unlockId, "test.first")).toBe(true);
    expect(session.unlock(unlockId, "test.second")).toBe(false);
    expect(session.isUnlocked(unlockId)).toBe(true);
    expect(session.listUnlocked()).toContain(unlockId);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      unlockId,
      source: "test.first",
      tick: 0,
    });

    off();
    session.dispose();
  });
});
