// Minimal React bridge on top of GameSession.
//
// Responsibilities (intentionally small):
// - Subscribe API for React (revision counter + Set<cb>), bumped whenever a
//   UI-visible mutation happens.
// - Autosave scheduling: 10 s throttle + immediate flush on important bus
//   events + beforeunload.
// - Clear-save flow.
//
// GameStore IS-A GameSession (type-level): `GameStore extends GameSession`.
// Adding a new gameplay command = add a method on CharacterController; the
// store picks it up for free via getFocusedCharacter().

import { TICK_MS } from "../core/infra/tick";
import { computeCatchUpTicks, MAX_CATCHUP_TICKS } from "../core/infra/tick/catch-up";
import { createGameSession, type GameSession } from "../core/session";
import type { ContentDb } from "../core/content";
import {
  deserialize,
  LocalStorageSaveAdapter,
  serialize,
  type SaveAdapter,
} from "../core/save";


const SAVE_KEY = "yaia:save";
const AUTOSAVE_INTERVAL_MS = 10_000;

// ---------- Public interface ----------

export interface GameStore extends GameSession {
  /** Subscribe to UI-visible mutations. Returns unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Monotonic counter bumped on every notify(); React uses this as its
   *  snapshot key via useSyncExternalStore. */
  getRevision(): number;
  /** Delete the save and reboot the session to content.starting. */
  clearSaveAndReset(): Promise<void>;
  /** Purchase the next level of an upgrade. Implemented by the underlying session. */
  purchaseUpgrade(upgradeId: string): void;

  /** Currently held upgrade ids, for UI listing. Thin pass-through —
   *  future UI may read directly from content. */
  listLocationIds(): string[];
  listUpgradeIds(): string[];
  /** Currency / WorldRecord accessors retained for convenience; they are
   *  trivial views on state and let UI components stay unchanged. */
  getCurrencies(): Record<string, number>;
  getWorldRecord(): GameSession["state"]["worldRecord"];
  /** Simulate offline catch-up for the given number of hours (debug only).
   *  Runs the same chunked pipeline as real catch-up. */
  debugSimulateCatchUp(hours: number): void;
  /** Cancel an in-progress catch-up (works for both real and debug). */
  cancelCatchUp(): void;
}

export interface CreateGameStoreOptions {
  content: ContentDb;
  seed?: number;
  saveAdapter?: SaveAdapter;
  /** If true, attempt to load on startup. Default: true. */
  autoLoad?: boolean;
  /** Injectable wall-clock source. Defaults to Date.now. Used by tests. */
  now?: () => number;
}

// ---------- Factory ----------

export function createGameStore(opts: CreateGameStoreOptions): GameStore {
  const session = createGameSession({
    content: opts.content,
    seed: opts.seed,
  });
  const adapter = opts.saveAdapter ?? new LocalStorageSaveAdapter();
  const attrDefs = opts.content.attributes;
  const now = opts.now ?? (() => Date.now());

  // ---------- Subscription plumbing ----------

  let revision = 0;
  const subs = new Set<() => void>();

  function notify(): void {
    revision += 1;
    for (const cb of [...subs]) cb();
  }

  // ---------- Persistence ----------

  /** Set true while catch-up is running so all persist calls are suppressed.
   *  Declared here (before persistNow) because persistence helpers reference it. */
  let catchUpRunning = false;

  let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaveAt = 0;
  /** True until tryLoad resolves. While true, persistNow is a no-op to prevent
   *  the fresh resetToFresh state from overwriting an existing save. */
  let loadInProgress = true;

  /** Force-persist ignoring catch-up guard. Only for beforeunload / page-hide
   *  where we MUST flush no matter what. */
  function persistNowForced(): void {
    if (loadInProgress) return;
    try {
      session.state.lastWallClockMs = now();
      const payload = serialize(session.state);
      adapter.save(SAVE_KEY, payload);
      lastSaveAt = now();
      console.debug("[save] persisted at tick", session.state.tick, "size", payload.length);
    } catch (e) {
      console.error("[save] persistNow failed:", e);
      throw e;
    }
  }

  function persistNow(): void {
    if (catchUpRunning) return;
    persistNowForced();
  }

  function schedulePersist(): void {
    if (catchUpRunning) return;
    if (pendingSaveTimer !== null) return;
    const sinceLast = now() - lastSaveAt;
    const delay = Math.max(500, AUTOSAVE_INTERVAL_MS - sinceLast);
    pendingSaveTimer = setTimeout(() => {
      pendingSaveTimer = null;
      persistNow();
    }, delay);
  }

  /** Minimum ms between two persist calls triggered by "soon" events.
   *  High-frequency gameplay events (damage, log, loot) call persistSoon;
   *  this gap prevents serializing every tick during combat. */
  const MIN_PERSIST_GAP_MS = 2_000;

  /** Schedule a persist within MIN_PERSIST_GAP_MS. If a timer already exists
   *  it stays — we don't push the deadline further out so save latency is
   *  bounded.  For truly critical moments use persistNowForced() directly. */
  function persistSoon(): void {
    if (catchUpRunning) return;
    if (pendingSaveTimer !== null) return;          // already scheduled
    const sinceLast = now() - lastSaveAt;
    if (sinceLast >= MIN_PERSIST_GAP_MS) {
      persistNow();
    } else {
      pendingSaveTimer = setTimeout(() => {
        pendingSaveTimer = null;
        persistNow();
      }, MIN_PERSIST_GAP_MS - sinceLast);
    }
  }

  // ---------- Engine + bus wiring ----------

  // Tick-driven UI pulse: every logic tick, bump revision and let the
  // autosave throttler decide whether to persist.
  session.engine.register({
    id: "__ui_notifier",
    tick: () => {
      notify();
      schedulePersist();
    },
  });

  const { bus } = session;

  // --- High-frequency events: notify UI only; rely on tick autosave ---
  bus.on("damage", notify);
  bus.on("kill", notify);
  bus.on("loot", notify);
  bus.on("pendingLootChanged", notify);
  bus.on("gameLogAppended", notify);

  // --- Low-frequency, player-visible mutations: persistSoon (throttled) ---
  bus.on("levelup", () => {
    notify();
    persistSoon();
  });
  bus.on("inventoryChanged", () => {
    notify();
    persistSoon();
  });
  bus.on("equipmentChanged", () => {
    notify();
    persistSoon();
  });
  bus.on("crafted", () => {
    notify();
    persistSoon();
  });
  bus.on("activityComplete", () => {
    notify();
    persistSoon();
  });
  bus.on("talentAllocated", () => {
    notify();
    persistSoon();
  });

  // ---------- Catch-up (offline / background tab) ----------

  // Hot-resume snapshot: recorded when the page becomes hidden.
  let hiddenAtMs: number | null = null;
  let hiddenAtTick: number | null = null;

  /** How many ticks to run per animation-frame slice. 10k ≈ 16 min game-time,
   *  typically runs in ~5-15 ms — well within a single frame budget. */
  const SLICE_SIZE = 10_000;

  /** If catch-up is ≤ this many ticks, run synchronously without UI overlay.
   *  3 000 ticks = 5 min of game-time at 10 Hz — imperceptible to the player. */
  const INSTANT_THRESHOLD = 3_000;

  /** Cancel flag for the currently running catch-up (if any). */
  let catchUpCancelRequested = false;

  /** Chunked catch-up executor. Small amounts run synchronously; larger amounts
   *  emit catchUpProgress each slice via rAF, then catchUpApplied when done.
   *  Used by both real recovery and debug simulation. */
  function runChunkedCatchUp(
    totalTicks: number,
    elapsedMs: number,
    wasCapped: boolean,
  ): void {
    if (totalTicks <= 0) {
      bus.emit("catchUpApplied", {
        elapsedMs,
        appliedTicks: 0,
        wasCapped,
      });
      return;
    }

    // Small catch-ups: run synchronously, no UI overlay.
    if (totalTicks <= INSTANT_THRESHOLD) {
      session.engine.step(totalTicks);
      persistSoon();
      bus.emit("catchUpApplied", {
        elapsedMs,
        appliedTicks: totalTicks,
        wasCapped,
      });
      return;
    }

    // Large catch-ups: chunked via rAF with progress events.
    catchUpRunning = true;
    catchUpCancelRequested = false;
    let done = 0;

    bus.emit("catchUpProgress", { done: 0, total: totalTicks });

    function slice() {
      if (catchUpCancelRequested) {
        catchUpRunning = false;
        persistSoon();
        bus.emit("catchUpApplied", {
          elapsedMs,
          appliedTicks: done,
          wasCapped,
          cancelled: true,
        });
        return;
      }
      const batch = Math.min(SLICE_SIZE, totalTicks - done);
      session.engine.step(batch);
      done += batch;
      bus.emit("catchUpProgress", { done, total: totalTicks });

      if (done >= totalTicks) {
        catchUpRunning = false;
        persistSoon();
        bus.emit("catchUpApplied", {
          elapsedMs,
          appliedTicks: totalTicks,
          wasCapped,
        });
      } else {
        requestAnimationFrame(slice);
      }
    }

    requestAnimationFrame(slice);
  }

  /** Compute and apply catch-up ticks from a wall-clock + logic-tick baseline.
   *  Used by both cold resume (tryLoad) and hot resume (visibilitychange). */
  function applyCatchUp(
    baseWallClockMs: number,
    baseLogicTick: number,
  ): void {
    const result = computeCatchUpTicks({
      lastWallClockMs: baseWallClockMs,
      nowMs: now(),
      lastLogicTick: baseLogicTick,
      currentLogicTick: session.engine.currentTick,
      tickMs: TICK_MS,
    });
    runChunkedCatchUp(result.ticksToApply, result.elapsedMs, result.wasCapped);
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      // Snapshot wall clock + logic tick before the browser throttles timers.
      hiddenAtMs = now();
      hiddenAtTick = session.engine.currentTick;
      persistNowForced();
    } else if (document.visibilityState === "visible") {
      if (hiddenAtMs !== null && hiddenAtTick !== null) {
        applyCatchUp(hiddenAtMs, hiddenAtTick);
        hiddenAtMs = null;
        hiddenAtTick = null;
      }
    }
  }


  // ---------- Load flow ----------

  async function tryLoad(): Promise<boolean> {
    try {
      const raw = await adapter.load(SAVE_KEY);
      if (!raw) return false;
      const loaded = deserialize(raw, { attrDefs });
      session.loadFromSave(loaded);
      // Cold-resume catch-up: compensate for time elapsed since this save
      // was last written.
      if (loaded.lastWallClockMs) {
        applyCatchUp(loaded.lastWallClockMs, loaded.tick);
      }
      notify();
      return true;
    } catch (e) {
      // Alpha: never silently discard a save. Surface the error so developers
      // can see exactly what broke deserialization / load.
      const msg = e instanceof Error ? e.message : String(e);
      console.error("load failed:", e);
      alert(`存档加载失败，请清除存档后重试。\n\n错误: ${msg}`);
      return false;
    } finally {
      loadInProgress = false;
    }
  }

  // ---------- Mix store-only methods onto the session ----------

  const baseDispose = session.dispose.bind(session);

  const store = Object.assign(session, {
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    getRevision: () => revision,
    listLocationIds: () => Object.keys(opts.content.locations),
    listUpgradeIds: () => Object.keys(opts.content.upgrades),
    getCurrencies: () => session.state.currencies,
    getWorldRecord: () => session.state.worldRecord,
    purchaseUpgrade(upgradeId: string) {
      session.purchaseUpgrade(upgradeId);
    },
    debugSimulateCatchUp(hours: number) {

      if (catchUpRunning) return; // one at a time
      const ticks = Math.min(
        Math.round((hours * 3_600_000) / TICK_MS),
        MAX_CATCHUP_TICKS,
      );
      const elapsedMs = hours * 3_600_000;
      runChunkedCatchUp(ticks, elapsedMs, ticks >= MAX_CATCHUP_TICKS);
    },
    cancelCatchUp() {
      catchUpCancelRequested = true;
    },
    async clearSaveAndReset() {
      if (pendingSaveTimer !== null) {
        clearTimeout(pendingSaveTimer);
        pendingSaveTimer = null;
      }
      session.resetToFresh();
      await adapter.remove(SAVE_KEY);
      notify();
    },
    dispose() {
      baseDispose();
      if (pendingSaveTimer !== null) clearTimeout(pendingSaveTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      subs.clear();
    },
  }) as GameStore;

  // Debug hook + flush-on-close. `window.__game` matches the old API so any
  // devtools inspectors keep working.
  if (typeof window !== "undefined") {
    (window as unknown as { __game: GameStore }).__game = store;
    window.addEventListener("beforeunload", () => {
      try {
        persistNowForced();
      } catch {
        /* swallow — page is closing anyway */
      }
    });
    // Hot-resume: snapshot on hide, catch-up on visible.
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  // Always bootstrap with a fresh state so the session is immediately usable
  // (characters Map populated, focusedCharId set). If a save exists, the async
  // tryLoad will overwrite this via loadFromSave; if not, we're already good.
  session.resetToFresh();

  if (opts.autoLoad !== false) {
    void tryLoad();
  } else {
    loadInProgress = false;
  }

  return store;
}

export { TICK_MS };
