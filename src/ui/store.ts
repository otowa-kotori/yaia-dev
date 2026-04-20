// Minimal bridge between game-core and React UI.
//
// Responsibilities:
// - Own the TickEngine, bus, rng, state, and live combat activity (if any).
// - Expose a trivial subscribe(callback) API for UI.
// - Publish a "revision number" that bumps every UI-visible mutation, so React
//   can re-render without deep equality checks.
// - Persist state: autosave on a throttle + on important events, load on
//   startup.
//
// Save integration notes:
// - The state is the source of truth. Activity is a Tickable that lives in
//   memory; on save, we record the character's activity pointer (stageId +
//   phase + wave + lastTransitionTick) inside PlayerCharacter.activity, so on
//   load we can re-create the runtime activity bound to the persisted Battle.
// - Rng state is synced into state.rngState every tick so saves always
//   contain an up-to-date rng snapshot without special handling.

import { createTickEngine, TICK_MS } from "../core/tick";
import { createGameEventBus } from "../core/events";
import { createRng, restoreRng } from "../core/rng";
import { createEmptyState, type GameState } from "../core/state";
import { setContent, type ContentDb } from "../core/content";
import {
  ACTIVITY_COMBAT_KIND,
  createCombatActivity,
  type CombatActivity,
  type CombatActivityPhase,
} from "../core/activity";
import { createPlayerCharacter, getAttr, type PlayerCharacter } from "../core/actor";
import { ATTR } from "../core/attribute";
import { registerBuiltinIntents } from "../core/intent";
import {
  deserialize,
  LocalStorageSaveAdapter,
  serialize,
  type SaveAdapter,
} from "../core/save";
import { basicAttack, defaultCharXpCurve, forestLv1 } from "../content";

const SAVE_KEY = "yaia:save";
const AUTOSAVE_INTERVAL_MS = 10_000;

export interface GameStore {
  readonly state: GameState;
  readonly activity: CombatActivity | null;
  subscribe(cb: () => void): () => void;
  getRevision(): number;
  startDemoBattle(): void;
  stopActivity(): void;
  clearSaveAndReset(): Promise<void>;
  getHero(): PlayerCharacter | null;
  isRunning(): boolean;
  setSpeedMultiplier(mul: number): void;
  getSpeedMultiplier(): number;
  dispose(): void;
}

export interface CreateGameStoreOptions {
  content: ContentDb;
  seed?: number;
  /** Override save backend. Default: LocalStorageSaveAdapter. */
  saveAdapter?: SaveAdapter;
  /** If true, attempt to load on startup. Default: true. */
  autoLoad?: boolean;
}

// ---------- Serialized activity pointer ----------
// Shape of the `data` blob stored on PlayerCharacter.activity when the char
// is currently grinding a stage. Sparse by design — only what's needed to
// resume.
interface CombatActivityData extends Record<string, unknown> {
  stageId: string;
  phase: CombatActivityPhase;
  waveIndex: number;
  lastTransitionTick: number;
  currentBattleId: string | null;
}

export function createGameStore(opts: CreateGameStoreOptions): GameStore {
  setContent(opts.content);
  registerBuiltinIntents();

  const seed = opts.seed ?? 42;
  const adapter = opts.saveAdapter ?? new LocalStorageSaveAdapter();
  const attrDefs = opts.content.attributes;

  let state = createEmptyState(seed, 1);
  const bus = createGameEventBus();
  let rng = createRng(seed);
  const engine = createTickEngine({ initialSpeedMultiplier: 1 });
  let activity: CombatActivity | null = null;
  let revision = 0;
  const subs = new Set<() => void>();

  // --- autosave plumbing ---
  let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaveAt = 0;

  function notify(): void {
    revision += 1;
    state.tick = engine.currentTick;
    state.rngState = rng.state;
    for (const cb of [...subs]) cb();
  }

  function persistNow(): void {
    try {
      const payload = serialize(state);
      void adapter.save(SAVE_KEY, payload);
      lastSaveAt = Date.now();
    } catch (e) {
      // Don't let a save crash the game loop. Surface to devtools so it's
      // visible during dev.
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
    // Important event: don't wait for the tail of the throttle.
    if (pendingSaveTimer !== null) {
      clearTimeout(pendingSaveTimer);
      pendingSaveTimer = null;
    }
    persistNow();
  }

  // Tick observer: bump revision + write an autosave periodically.
  engine.register({
    id: "__ui_notifier",
    tick: () => {
      notify();
      schedulePersist();
    },
  });

  bus.on("damage", notify);
  bus.on("kill", notify);
  bus.on("levelup", () => {
    notify();
    persistSoon();
  });
  bus.on("activityComplete", () => {
    activity = null;
    // Clear the persisted activity pointer on the hero so it doesn't try to
    // resume a stopped activity on next load.
    const hero = state.actors.find((a) => a.kind === "player") as
      | PlayerCharacter
      | undefined;
    if (hero) hero.activity = null;
    notify();
    persistSoon();
  });

  const stopLoop = engine.start();

  function ensureHero(): PlayerCharacter {
    let hero = state.actors.find((a) => a.kind === "player") as
      | PlayerCharacter
      | undefined;
    if (!hero) {
      hero = createPlayerCharacter({
        id: "hero.1",
        name: "Hero",
        xpCurve: defaultCharXpCurve,
        knownAbilities: [basicAttack.id],
        attrDefs,
      });
      state.actors.push(hero);
    }
    return hero;
  }

  /** Write the live activity's resume pointer onto the hero. Called whenever
   *  the activity is installed/modified so an autosave captures current
   *  progress without a separate sync step. */
  function syncActivityPointer(): void {
    const hero = state.actors.find((a) => a.kind === "player") as
      | PlayerCharacter
      | undefined;
    if (!hero) return;
    if (!activity || activity.phase === "stopped") {
      hero.activity = null;
      return;
    }
    const data: CombatActivityData = {
      stageId: activity.stageId,
      phase: activity.phase,
      waveIndex: activity.waveIndex,
      lastTransitionTick: activity.lastTransitionTick,
      currentBattleId: activity.currentBattleId,
    };
    hero.activity = {
      kind: ACTIVITY_COMBAT_KIND,
      startedAtTick: activity.startedAtTick,
      data,
    };
  }

  /** Start a new grind. If an activity is already running, do nothing. */
  function startDemoBattle(): void {
    if (activity && activity.phase !== "stopped") return;

    const hero = ensureHero();
    hero.activeEffects = [];
    hero.cooldowns = {};
    hero.currentHp = getAttr(hero, ATTR.MAX_HP, attrDefs);
    hero.currentMp = getAttr(hero, ATTR.MAX_MP, attrDefs);

    activity = createCombatActivity({
      ownerCharacterId: hero.id,
      stageId: forestLv1.id,
      ctxProvider: () => ({
        state,
        bus,
        rng,
        attrDefs,
        currentTick: engine.currentTick,
      }),
      actionDelayTicks: 8,
      recoverHpPctPerTick: 0.02,
    });
    engine.register(activity);
    syncActivityPointer();
    notify();
    persistSoon();
  }

  /** Rebuild an activity after loading a save that had one in-flight. */
  function rehydrateActivity(): void {
    const hero = state.actors.find((a) => a.kind === "player") as
      | PlayerCharacter
      | undefined;
    if (!hero || !hero.activity) return;
    if (hero.activity.kind !== ACTIVITY_COMBAT_KIND) return;
    const data = hero.activity.data as CombatActivityData;

    activity = createCombatActivity({
      ownerCharacterId: hero.id,
      stageId: data.stageId,
      ctxProvider: () => ({
        state,
        bus,
        rng,
        attrDefs,
        currentTick: engine.currentTick,
      }),
      actionDelayTicks: 8,
      recoverHpPctPerTick: 0.02,
      resume: {
        phase: data.phase,
        waveIndex: data.waveIndex,
        lastTransitionTick: data.lastTransitionTick,
        currentBattleId: data.currentBattleId,
      },
    });
    if (activity.phase !== "stopped") engine.register(activity);
    notify();
  }

  /** Load from save if one exists. Returns true if a save was loaded. */
  async function tryLoad(): Promise<boolean> {
    try {
      const raw = await adapter.load(SAVE_KEY);
      if (!raw) return false;
      const loaded = deserialize(raw, { attrDefs });
      state = loaded;
      rng = restoreRng(loaded.rngState);
      engine.setTick(loaded.tick);
      rehydrateActivity();
      notify();
      return true;
    } catch (e) {
      console.error("load failed; continuing with a fresh state:", e);
      return false;
    }
  }

  const store: GameStore = {
    get state() {
      return state;
    },
    get activity() {
      return activity;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getRevision: () => revision,
    getHero: () => {
      const h = state.actors.find((a) => a.kind === "player");
      return h ? (h as PlayerCharacter) : null;
    },
    startDemoBattle,
    stopActivity() {
      if (activity) {
        activity.stopRequested = true;
        syncActivityPointer();
      }
      notify();
      persistSoon();
    },
    async clearSaveAndReset() {
      // Stop anything in flight, wipe state + save slot.
      if (activity) activity.phase = "stopped";
      activity = null;
      for (const t of engine.listTickables()) {
        if (t.id !== "__ui_notifier") engine.unregister(t.id);
      }
      if (pendingSaveTimer !== null) {
        clearTimeout(pendingSaveTimer);
        pendingSaveTimer = null;
      }
      state = createEmptyState(seed, 1);
      rng = createRng(seed);
      engine.setTick(0);
      await adapter.remove(SAVE_KEY);
      notify();
    },
    isRunning: () => activity !== null && activity.phase !== "stopped",
    setSpeedMultiplier(m) {
      engine.speedMultiplier = m;
      notify();
    },
    getSpeedMultiplier: () => engine.speedMultiplier,
    dispose() {
      stopLoop();
      if (pendingSaveTimer !== null) clearTimeout(pendingSaveTimer);
      subs.clear();
    },
  };

  if (typeof window !== "undefined") {
    (window as unknown as { __game: GameStore }).__game = store;
    // Best-effort save on tab close.
    window.addEventListener("beforeunload", () => {
      try {
        persistNow();
      } catch {
        /* swallow — page is closing anyway */
      }
    });
  }

  if (opts.autoLoad !== false) {
    void tryLoad();
  }

  return store;
}

export { TICK_MS };
