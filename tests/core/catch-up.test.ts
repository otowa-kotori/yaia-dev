import { describe, expect, it } from "bun:test";
import {
  computeCatchUpTicks,
  MAX_CATCHUP_MS,
  MAX_CATCHUP_TICKS,
  type CatchUpParams,
} from "../../src/core/tick/catch-up";
import { TICK_MS } from "../../src/core/tick";

// Helper — build params with sane defaults so each test only overrides
// the dimension it cares about.
function params(overrides: Partial<CatchUpParams> = {}): CatchUpParams {
  return {
    lastWallClockMs: 1_000_000,
    nowMs: 1_000_000,
    lastLogicTick: 0,
    currentLogicTick: 0,
    tickMs: TICK_MS,
    ...overrides,
  };
}

describe("computeCatchUpTicks", () => {
  // ------ Zero / trivial ------

  it("returns 0 when no time has elapsed", () => {
    const r = computeCatchUpTicks(params());
    expect(r.ticksToApply).toBe(0);
    expect(r.elapsedMs).toBe(0);
    expect(r.wasCapped).toBe(false);
  });

  it("returns 0 when elapsed is less than one tick", () => {
    const r = computeCatchUpTicks(params({ nowMs: 1_000_000 + TICK_MS - 1 }));
    expect(r.ticksToApply).toBe(0);
    expect(r.elapsedMs).toBe(TICK_MS - 1);
    expect(r.wasCapped).toBe(false);
  });

  // ------ Normal catch-up ------

  it("computes correct ticks for a short absence (10 s)", () => {
    const elapsed = 10_000; // 10 s
    const r = computeCatchUpTicks(
      params({ nowMs: 1_000_000 + elapsed }),
    );
    expect(r.ticksToApply).toBe(Math.floor(elapsed / TICK_MS));
    expect(r.elapsedMs).toBe(elapsed);
    expect(r.wasCapped).toBe(false);
  });

  it("computes correct ticks for a long absence (2 h)", () => {
    const elapsed = 2 * 60 * 60 * 1000;
    const r = computeCatchUpTicks(
      params({ nowMs: 1_000_000 + elapsed }),
    );
    expect(r.ticksToApply).toBe(Math.floor(elapsed / TICK_MS));
    expect(r.wasCapped).toBe(false);
  });

  // ------ Cap ------

  it("caps at MAX_CATCHUP_TICKS for absence exceeding 24 h", () => {
    const elapsed = MAX_CATCHUP_MS + 60_000; // 24 h + 1 min
    const r = computeCatchUpTicks(
      params({ nowMs: 1_000_000 + elapsed }),
    );
    expect(r.ticksToApply).toBe(MAX_CATCHUP_TICKS);
    expect(r.elapsedMs).toBe(elapsed);
    expect(r.wasCapped).toBe(true);
  });

  it("exactly 24 h is not capped", () => {
    const elapsed = MAX_CATCHUP_MS;
    const r = computeCatchUpTicks(
      params({ nowMs: 1_000_000 + elapsed }),
    );
    expect(r.ticksToApply).toBe(MAX_CATCHUP_TICKS);
    expect(r.wasCapped).toBe(false);
  });

  // ------ Partial advancement during background ------

  it("subtracts ticks already advanced during background", () => {
    const elapsed = 10_000; // 10 s → expected 100 ticks
    const alreadyAdvanced = 30;
    const r = computeCatchUpTicks(
      params({
        nowMs: 1_000_000 + elapsed,
        lastLogicTick: 100,
        currentLogicTick: 100 + alreadyAdvanced,
      }),
    );
    expect(r.ticksToApply).toBe(100 - alreadyAdvanced);
  });

  it("returns 0 when engine already advanced enough ticks", () => {
    const elapsed = 5_000; // 50 expected
    const r = computeCatchUpTicks(
      params({
        nowMs: 1_000_000 + elapsed,
        lastLogicTick: 0,
        currentLogicTick: 60, // already ahead
      }),
    );
    expect(r.ticksToApply).toBe(0);
  });

  // ------ Negative / edge guards ------

  it("handles nowMs < lastWallClockMs (clock skew) gracefully", () => {
    const r = computeCatchUpTicks(
      params({ lastWallClockMs: 2_000_000, nowMs: 1_000_000 }),
    );
    expect(r.ticksToApply).toBe(0);
    expect(r.elapsedMs).toBe(0);
    expect(r.wasCapped).toBe(false);
  });

  it("handles currentLogicTick < lastLogicTick gracefully", () => {
    // Defensive — should not happen in practice, but the function must not
    // return negative ticks.
    const elapsed = 5_000;
    const r = computeCatchUpTicks(
      params({
        nowMs: 1_000_000 + elapsed,
        lastLogicTick: 100,
        currentLogicTick: 50,
      }),
    );
    // expectedTicks = 50, actualAdvanced clamped to 0 → apply 50
    expect(r.ticksToApply).toBe(50);
  });

  // ------ Constant sanity ------

  it("MAX_CATCHUP_TICKS equals 10 Hz × 24 h", () => {
    expect(MAX_CATCHUP_TICKS).toBe(864_000);
  });

  it("MAX_CATCHUP_MS equals 24 h in ms", () => {
    expect(MAX_CATCHUP_MS).toBe(86_400_000);
  });
});
