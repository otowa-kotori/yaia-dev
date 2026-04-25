// Integration tests for the catch-up mechanism.
//
// Core invariant: running N+M ticks continuously must produce the exact same
// state as running N ticks, then catch-up-stepping M ticks. This holds because
// engine.step is deterministic and RNG is seeded.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetContent } from "../../../src/core/content";
import { createGameSession, type GameSession } from "../../../src/core/session";
import { computeCatchUpTicks } from "../../../src/core/infra/tick/catch-up";
import { TICK_MS } from "../../../src/core/infra/tick";
import { serialize } from "../../../src/core/save/serialize";
import {
  basicAttackTalent,
  forestCombatZone,
  forestLocation,
  loadFixtureContent,
  mineLocation,
  testVein,
  testXpCurve,
} from "../../fixtures/content";

// ---------- Helpers ----------

const SEED = 42;
const liveSessions: GameSession[] = [];

/** Create a session with a hero at the given location. Speed = 0 so the
 *  real-time loop doesn't interfere; we drive ticks manually. */
function createSession(initialLocationId: string): GameSession {
  const content = loadFixtureContent();
  content.starting = {
    heroes: [
      {
        id: "hero.catchup",
        name: "Catch-up Hero",
        xpCurve: testXpCurve,
        knownTalents: [basicAttackTalent.id],
      },
    ],
    initialLocationId: initialLocationId as never,
  };
  const session = createGameSession({ content, seed: SEED });
  session.setSpeedMultiplier(0);
  session.resetToFresh();
  liveSessions.push(session);
  return session;
}

/** Serialized snapshot of the meaningful state fields for comparison.
 *  We strip lastWallClockMs since it's wall-clock dependent and not
 *  relevant to logical equivalence. */
function snapshot(session: GameSession): string {
  const raw = serialize(session.state);
  const parsed = JSON.parse(raw) as { state: Record<string, unknown> };
  delete parsed.state.lastWallClockMs;
  return JSON.stringify(parsed);
}

// ---------- Lifecycle ----------

beforeEach(() => {
  resetContent();
});

afterEach(() => {
  while (liveSessions.length > 0) {
    liveSessions.pop()!.dispose();
  }
  resetContent();
});

// ---------- Tests ----------

describe("catch-up integration: continuous vs split+catchup equivalence", () => {
  test("idle (no activity): N+M continuous == N then catch-up M", () => {
    const N = 50;
    const M = 100;

    // Control: continuous run.
    const control = createSession(forestLocation.id);
    control.engine.step(N + M);
    const controlSnap = snapshot(control);

    // Experiment: run N, then catch-up M.
    const experiment = createSession(forestLocation.id);
    experiment.engine.step(N);

    const baseWallClockMs = 1_000_000;
    const nowMs = baseWallClockMs + M * TICK_MS;
    const result = computeCatchUpTicks({
      lastWallClockMs: baseWallClockMs,
      nowMs,
      lastLogicTick: experiment.engine.currentTick,
      currentLogicTick: experiment.engine.currentTick,
      tickMs: TICK_MS,
    });
    expect(result.ticksToApply).toBe(M);
    experiment.engine.step(result.ticksToApply);

    expect(snapshot(experiment)).toBe(controlSnap);
  });

  test("combat: N+M continuous == N then catch-up M", () => {
    const N = 30;
    const M = 200;

    // Control: start fight then run all ticks.
    const control = createSession(forestLocation.id);
    control.getFocusedCharacter().startFight(forestCombatZone.id);
    control.engine.step(N + M);
    const controlSnap = snapshot(control);

    // Experiment: start fight, run N, then catch-up M.
    const experiment = createSession(forestLocation.id);
    experiment.getFocusedCharacter().startFight(forestCombatZone.id);
    experiment.engine.step(N);

    const baseWallClockMs = 1_000_000;
    const nowMs = baseWallClockMs + M * TICK_MS;
    const result = computeCatchUpTicks({
      lastWallClockMs: baseWallClockMs,
      nowMs,
      lastLogicTick: experiment.engine.currentTick,
      currentLogicTick: experiment.engine.currentTick,
      tickMs: TICK_MS,
    });
    expect(result.ticksToApply).toBe(M);
    experiment.engine.step(result.ticksToApply);

    expect(snapshot(experiment)).toBe(controlSnap);
  });

  test("gathering: N+M continuous == N then catch-up M", () => {
    const N = 20;
    const M = 60;

    // Control.
    const control = createSession(mineLocation.id);
    control.getFocusedCharacter().startGather(testVein.id);
    control.engine.step(N + M);
    const controlSnap = snapshot(control);

    // Experiment.
    const experiment = createSession(mineLocation.id);
    experiment.getFocusedCharacter().startGather(testVein.id);
    experiment.engine.step(N);

    const baseWallClockMs = 1_000_000;
    const nowMs = baseWallClockMs + M * TICK_MS;
    const result = computeCatchUpTicks({
      lastWallClockMs: baseWallClockMs,
      nowMs,
      lastLogicTick: experiment.engine.currentTick,
      currentLogicTick: experiment.engine.currentTick,
      tickMs: TICK_MS,
    });
    expect(result.ticksToApply).toBe(M);
    experiment.engine.step(result.ticksToApply);

    expect(snapshot(experiment)).toBe(controlSnap);
  });

  test("partial background advancement is subtracted correctly", () => {
    const N = 50;
    const M = 100;
    const backgroundAdvanced = 30;

    // Control: continuous N+M.
    const control = createSession(forestLocation.id);
    control.getFocusedCharacter().startFight(forestCombatZone.id);
    control.engine.step(N + M);
    const controlSnap = snapshot(control);

    // Experiment: run N, then simulate browser pushing `backgroundAdvanced`
    // ticks during background, then catch-up the remainder.
    const experiment = createSession(forestLocation.id);
    experiment.getFocusedCharacter().startFight(forestCombatZone.id);
    experiment.engine.step(N);

    // Browser managed to push some ticks while hidden.
    experiment.engine.step(backgroundAdvanced);

    const baseWallClockMs = 1_000_000;
    const nowMs = baseWallClockMs + M * TICK_MS;
    const result = computeCatchUpTicks({
      lastWallClockMs: baseWallClockMs,
      nowMs,
      lastLogicTick: N,
      currentLogicTick: experiment.engine.currentTick,
      tickMs: TICK_MS,
    });
    expect(result.ticksToApply).toBe(M - backgroundAdvanced);

    experiment.engine.step(result.ticksToApply);
    expect(snapshot(experiment)).toBe(controlSnap);
  });

  test("catch-up with capped elapsed still produces valid state", () => {
    // Run 1000 ticks as catch-up to verify no crash or invariant violation
    // when the catch-up amount is non-trivial.
    const session = createSession(forestLocation.id);
    session.getFocusedCharacter().startFight(forestCombatZone.id);
    session.engine.step(10);

    const elapsed = 1000 * TICK_MS;
    const result = computeCatchUpTicks({
      lastWallClockMs: 0,
      nowMs: elapsed,
      lastLogicTick: 0,
      currentLogicTick: session.engine.currentTick,
      tickMs: TICK_MS,
    });
    // Should want 1000 - 10 = 990 ticks.
    expect(result.ticksToApply).toBe(990);
    // This should not throw.
    session.engine.step(result.ticksToApply);
    expect(session.engine.currentTick).toBe(1000);
  });
});
