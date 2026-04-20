import { describe, test, expect } from "bun:test";
import { createEmptyState, SHARED_INVENTORY_KEY } from "../../src/core/state";

describe("state", () => {
  test("createEmptyState produces a well-formed, JSON-safe state", () => {
    const s = createEmptyState(12345, 1);
    expect(s.version).toBe(1);
    expect(s.rngSeed).toBe(12345);
    expect(s.rngState).toBe(12345);
    expect(s.tick).toBe(0);
    expect(s.actors).toEqual([]);
    expect(s.battles).toEqual([]);
    expect(s.inventories[SHARED_INVENTORY_KEY]).toEqual([]);
    expect(s.worldActivities).toEqual([]);
    expect(s.flags).toEqual({});
    expect(s.settings.speedMultiplier).toBe(1);

    // JSON round-trip must be lossless.
    const roundTripped = JSON.parse(JSON.stringify(s));
    expect(roundTripped).toEqual(s);
  });

  test("seed is coerced to uint32", () => {
    const s = createEmptyState(-1, 1); // -1 >>> 0 === 4294967295
    expect(s.rngSeed).toBe(4294967295);
    expect(s.rngState).toBe(4294967295);
  });
});
