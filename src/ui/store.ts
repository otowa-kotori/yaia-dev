// Minimal React bridge on top of GameSession.
//
// Responsibilities (intentionally small):
// - Subscribe API for React (revision counter + Set<cb>), bumped whenever a
//   UI-visible mutation happens.
// - Autosave scheduling: 10 s throttle + immediate flush on important bus
//   events + beforeunload.
// - Clear-save flow.
//
// What this file is NOT doing any more:
// - It does NOT encode any game rules. All gameplay logic (enter stage,
//   start fight, purchase upgrade, rehydrate activity, etc.) lives in
//   src/core/session. This file physically is a GameSession with a few
//   extra methods mixed in — see `Object.assign(session, …)` below — so
//   `store.enterStage(id)` calls straight through to the session's own
//   method with zero forwarding boilerplate.
// - It does NOT own GameState, rng, engine, or bus; those belong to the
//   session.
//
// GameStore IS-A GameSession (type-level): `GameStore extends GameSession`.
// Adding a new gameplay command = add a method on GameSession; the store
// picks it up for free.

import { TICK_MS } from "../core/tick";
import { createGameSession, type GameSession } from "../core/session";
import type { ContentDb } from "../core/content";
import {
  deserialize,
  LocalStorageSaveAdapter,
  serialize,
  type SaveAdapter,
} from "../core/save";
import { purchaseUpgrade as purchaseUpgradeImpl, type UpgradePurchaseContext } from "../core/upgrade-manager";

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
  listStageIds(): string[];
  listUpgradeIds(): string[];
  /** Currency / WorldRecord accessors retained for convenience; they are
   *  trivial views on state and let UI components stay unchanged. */
  getCurrencies(): Record<string, number>;
  getWorldRecord(): GameSession["state"]["worldRecord"];
}

export interface CreateGameStoreOptions {
  content: ContentDb;
  seed?: number;
  saveAdapter?: SaveAdapter;
  /** If true, attempt to load on startup. Default: true. */
  autoLoad?: boolean;
}

// ---------- Factory ----------

export function createGameStore(opts: CreateGameStoreOptions): GameStore {
  const session = createGameSession({
    content: opts.content,
    seed: opts.seed,
  });
  const adapter = opts.saveAdapter ?? new LocalStorageSaveAdapter();
  const attrDefs = opts.content.attributes;

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
      const payload = serialize(session.state);
      void adapter.save(SAVE_KEY, payload);
      lastSaveAt = Date.now();
    } catch (e) {
      console.error("save failed:", e);
    }
  }

  function schedulePersist(): void {
    if (pendingSaveTimer !== null) return;
    const sinceLast = Date.now() - lastSaveAt;
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
  bus.on("activityComplete", () => {
    notify();
    persistSoon();
  });

  // ---------- Load flow ----------

  async function tryLoad(): Promise<boolean> {
    try {
      const raw = await adapter.load(SAVE_KEY);
      if (!raw) return false;
      const loaded = deserialize(raw, { attrDefs });
      session.loadFromSave(loaded);
      notify();
      return true;
    } catch (e) {
      console.error("load failed; continuing with a fresh state:", e);
      return false;
    }
  }

  // ---------- Mix store-only methods onto the session ----------
  //
  // The key move: `Object.assign(session, { … })` returns the session
  // itself, typed as GameStore. UI code keeps writing `s.enterStage(id)`
  // exactly as before — it now dispatches to session.enterStage directly
  // with no forwarding shim.
  //
  // Store-owned methods either hook into persist/notify (clearSaveAndReset,
  // purchaseUpgrade) or expose tiny content lookups the UI already depended
  // on (listStageIds, getCurrencies, …).

  const baseDispose = session.dispose.bind(session);

  const store = Object.assign(session, {
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    getRevision: () => revision,
    listStageIds: () => Object.keys(opts.content.stages),
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
        notify();
        persistSoon();
      }
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
  }

  if (opts.autoLoad !== false) {
    // If there was no save, bootstrap a brand-new game using the content's
    // StartingConfig. If load fails (e.g. corrupted), `tryLoad` already
    // logged the error and we fall through to the fresh path.
    void tryLoad().then((loaded) => {
      if (!loaded) session.resetToFresh();
    });
  }

  return store;
}

export { TICK_MS };
