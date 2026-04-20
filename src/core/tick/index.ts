// Tick engine.
//
// Time convention: everything inside game-core is measured in LOGIC TICKS.
// Milliseconds only appear at the UI boundary (setInterval below and animation).
// Default physical tick rate is 10 Hz (100ms). speedMultiplier scales how many
// logic ticks advance per physical tick (0 = paused, 2 = 2x, etc.).
//
// All combat / activity progression must happen inside a Tickable.tick() call.
// DO NOT use setTimeout/setInterval/useEffect to drive game logic — it breaks
// pause, speed-up, headless simulation, and offline catch-up.
//
// Tickable execution order (invariants):
//   1. Tickables run in REGISTRATION ORDER within each step. Internally the
//      engine stores them in a Map, whose iteration order is insertion order
//      per the ECMAScript spec.
//   2. There is no priority field by design. If two tickables need a strict
//      "A before B" relationship, co-locate that order inside ONE tickable
//      rather than leaking it into global config.
//   3. register() on an existing id throws. To reorder, unregister first; the
//      new registration goes to the END.
//   4. A tickable newly registered during step(N) is NOT ticked in step N; it
//      starts in step N+1. This is intentional — it keeps each step's visible
//      order fixed at the time step() began.
//   5. isDone tickables are removed AFTER the step they finished in, not
//      before.
//   6. Load-game: when rebuilding tickables from GameState, register them in
//      the same order as the state arrays (characters[], worldActivities[]).
//      Array order IS the save's source of truth for execution order.

export const TICK_MS = 100;

export interface TickContext {
  /** Logic tick index AT THE START of this tick (monotonic, never resets). */
  readonly currentTick: number;
}

export interface Tickable {
  /** Stable id for debug / deregistration. */
  readonly id: string;
  /** Advance state by 1 logic tick. */
  tick(ctx: TickContext): void;
  /** When true, engine will auto-unregister this tickable after the tick. */
  isDone?(): boolean;
}

export interface TickEngine {
  readonly currentTick: number;
  speedMultiplier: number;
  register(t: Tickable): () => void;
  unregister(id: string): void;
  /** Advance by n logic ticks synchronously. Pure w.r.t. registered tickables. */
  step(n?: number): void;
  /** Start the real-time loop (browser). Returns a stop() function. */
  start(): () => void;
  /** Reset clock (used by load-game). */
  setTick(tick: number): void;
  /** For inspection/testing. */
  listTickables(): readonly Tickable[];
}

export interface TickEngineOptions {
  initialTick?: number;
  initialSpeedMultiplier?: number;
  /** Physical ms between real-time ticks. Defaults to TICK_MS. */
  physicalIntervalMs?: number;
  /** Injected timer source — override for tests. */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export function createTickEngine(opts: TickEngineOptions = {}): TickEngine {
  const physicalMs = opts.physicalIntervalMs ?? TICK_MS;
  const setI =
    opts.setInterval ??
    ((fn: () => void, ms: number) => globalThis.setInterval(fn, ms));
  const clearI =
    opts.clearInterval ??
    ((h: unknown) => globalThis.clearInterval(h as number));

  let currentTick = opts.initialTick ?? 0;
  let speedMultiplier = opts.initialSpeedMultiplier ?? 1;
  const tickables = new Map<string, Tickable>();

  function stepOne(): void {
    const ctx: TickContext = { currentTick };
    // Snapshot to tolerate register/unregister during tick.
    const list = [...tickables.values()];
    for (const t of list) {
      t.tick(ctx);
    }
    // Auto-prune done tickables after the tick completes.
    for (const t of list) {
      if (t.isDone && t.isDone()) tickables.delete(t.id);
    }
    currentTick += 1;
  }

  const engine: TickEngine = {
    get currentTick() {
      return currentTick;
    },
    get speedMultiplier() {
      return speedMultiplier;
    },
    set speedMultiplier(v: number) {
      if (!Number.isFinite(v) || v < 0) {
        throw new Error(`speedMultiplier must be finite >= 0, got ${v}`);
      }
      speedMultiplier = v;
    },
    register(t) {
      if (tickables.has(t.id)) {
        throw new Error(`tick: duplicate tickable id "${t.id}"`);
      }
      tickables.set(t.id, t);
      return () => engine.unregister(t.id);
    },
    unregister(id) {
      tickables.delete(id);
    },
    step(n = 1) {
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`step: n must be a non-negative integer, got ${n}`);
      }
      for (let i = 0; i < n; i++) stepOne();
    },
    start() {
      const handle = setI(() => {
        // Real-time tick: advance speedMultiplier logic ticks.
        // Fractional multipliers (e.g. 0.5x) accumulate via a remainder.
        const advance = Math.max(0, speedMultiplier);
        // For fractional: accumulate and consume whole ticks.
        fractionalAccumulator += advance;
        const whole = Math.floor(fractionalAccumulator);
        fractionalAccumulator -= whole;
        if (whole > 0) engine.step(whole);
      }, physicalMs);
      return () => clearI(handle);
    },
    setTick(tick) {
      if (!Number.isInteger(tick) || tick < 0) {
        throw new Error(`setTick: must be non-negative integer, got ${tick}`);
      }
      currentTick = tick;
    },
    listTickables() {
      return [...tickables.values()];
    },
  };

  let fractionalAccumulator = 0;

  return engine;
}

/**
 * Headless simulation helper. Advances the given engine by `n` logic ticks.
 * Useful for offline catch-up and deterministic tests.
 *
 * This is a thin wrapper over engine.step(n) kept for call-site readability.
 */
export function runForTicks(engine: TickEngine, n: number): void {
  engine.step(n);
}
