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

import { TICK_MS } from "../core/tick";
import { computeCatchUpTicks, MAX_CATCHUP_TICKS } from "../core/tick/catch-up";
import { createGameSession, type GameSession } from "../core/session";
import type { ContentDb } from "../core/content";
import {
  deserialize,
  LocalStorageSaveAdapter,
  serialize,
  type SaveAdapter,
} from "../core/save";
import { purchaseUpgrade as purchaseUpgradeImpl, type UpgradePurchaseContext } from "../core/upgrade-manager";
import { isPlayer, rebuildCharacterDerived } from "../core/actor";

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
  /** Purchase the next level of an upgrade. No-op on funded failure.
   *  Kept here (not on GameSession) because the upgrade-manager lives in
   *  its own module and is already a pure state transaction; the store
   *  just glues in notify + persistSoon. */
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

  let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaveAt = 0;

  function persistNow(): void {
    try {
      // Stamp wall clock before serializing so the save carries the latest
      // real-world timestamp for offline catch-up.
      session.state.lastWallClockMs = now();
      const payload = serialize(session.state);
      void adapter.save(SAVE_KEY, payload);
      lastSaveAt = now();
    } catch (e) {
      console.error("save failed:", e);
    }
  }

  function schedulePersist(): void {
    if (pendingSaveTimer !== null) return;
    const sinceLast = now() - lastSaveAt;
    const delay = Math.max(500, AUTOSAVE_INTERVAL_MS - sinceLast);
    pendingSaveTimer = setTimeout(() => {
      pendingSaveTimer = null;
      persistNow();
    }, delay);
  }

  function persistSoon(): void {
    if (pendingSaveTimer !== null) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    persistNow();
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
  bus.on("damage", notify);
  bus.on("kill", notify);
  bus.on("levelup", () => {
    // Level-ups are rare and player-visible; flush immediately so the
    // save file reflects them even if the tab is closed seconds later.
    notify();
    persistSoon();
  });
  bus.on("loot", notify);
  bus.on("pendingLootChanged", notify);
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
  let catchUpRunning = false;

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
      persistNow();
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
      console.error("load failed; continuing with a fresh state:", e);
      return false;
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
      const ctx: UpgradePurchaseContext = {
        state: session.state,
        content: opts.content,
        attrDefs,
      };
      const result = purchaseUpgradeImpl(upgradeId, ctx);
      if (result.success) {
        // Rebuild derived attrs for ALL heroes (world upgrades affect everyone).
        for (const actor of session.state.actors) {
          if (isPlayer(actor)) {
            rebuildCharacterDerived(actor, attrDefs, session.state.worldRecord);
          }
        }
        notify();
        persistSoon();
      }
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
        persistNow();
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
  }

  return store;
}

export { TICK_MS };
