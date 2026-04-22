// Catch-up (offline / background tab) tick computation.
//
// Pure function — all inputs are explicit parameters so the logic is fully
// testable without browser APIs. The caller (store.ts) is responsible for
// reading wall-clock timestamps and invoking engine.step() with the result.
//
// Formula:
//   expectedTicks  = floor(clampedElapsedMs / tickMs)
//   actualAdvanced = currentLogicTick - lastLogicTick
//   missingTicks   = max(0, expectedTicks - actualAdvanced)
//
// "actualAdvanced" accounts for any ticks the browser managed to push through
// during the hidden / throttled period, preventing double-counting.

import { TICK_MS } from "./index";

// ---------- Constants ----------

/** Maximum wall-clock duration eligible for catch-up (24 h). */
export const MAX_CATCHUP_MS = 24 * 60 * 60 * 1000; // 86_400_000

/** Maximum logic ticks that catch-up will ever apply (10 Hz × 24 h). */
export const MAX_CATCHUP_TICKS = Math.floor(MAX_CATCHUP_MS / TICK_MS); // 864_000

// ---------- Types ----------

/** All inputs needed to compute catch-up. Passed in explicitly so the
 *  function stays pure and easy to unit-test. */
export interface CatchUpParams {
  /** Wall-clock timestamp recorded at the last save or visibility-hide snapshot. */
  lastWallClockMs: number;
  /** Current wall-clock timestamp (caller passes Date.now() or a test stub). */
  nowMs: number;
  /** Logic tick recorded at the last save or visibility-hide snapshot. */
  lastLogicTick: number;
  /** Current engine logic tick. */
  currentLogicTick: number;
  /** Milliseconds per logic tick. Almost always TICK_MS (100). */
  tickMs: number;
}

export interface CatchUpResult {
  /** Number of ticks to feed into engine.step(). Always >= 0. */
  ticksToApply: number;
  /** Raw wall-clock milliseconds that elapsed (before capping). */
  elapsedMs: number;
  /** True when the cap reduced the effective catch-up amount. */
  wasCapped: boolean;
}

// ---------- Core ----------

export function computeCatchUpTicks(params: CatchUpParams): CatchUpResult {
  const { lastWallClockMs, nowMs, lastLogicTick, currentLogicTick, tickMs } =
    params;

  // Elapsed wall-clock time. Clamp negatives (clock skew / test edge cases).
  const rawElapsedMs = Math.max(0, nowMs - lastWallClockMs);

  // Apply wall-clock cap.
  const cappedMs = Math.min(rawElapsedMs, MAX_CATCHUP_MS);
  const wasCapped = rawElapsedMs > MAX_CATCHUP_MS;

  // How many ticks SHOULD have been processed during this window (1x speed).
  const expectedTicks = Math.floor(cappedMs / tickMs);

  // How many ticks the engine actually managed to advance (browser throttled
  // timers may have pushed through a partial amount).
  const actualAdvanced = Math.max(0, currentLogicTick - lastLogicTick);

  // The gap. Clamp to [0, MAX_CATCHUP_TICKS].
  const raw = expectedTicks - actualAdvanced;
  const ticksToApply = Math.min(Math.max(0, raw), MAX_CATCHUP_TICKS);

  return {
    ticksToApply,
    elapsedMs: rawElapsedMs,
    wasCapped: wasCapped || ticksToApply < raw,
  };
}
