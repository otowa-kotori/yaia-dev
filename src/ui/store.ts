// Minimal bridge between game-core and React UI.
//
// Responsibilities:
// - Own the TickEngine, bus, rng, state, stage controller, and activity.
// - Expose a trivial subscribe(callback) API for UI.
// - Publish a "revision number" that bumps every UI-visible mutation, so React
//   can re-render without deep equality checks.
// - Persist state: autosave on a throttle + on important events, load on
//   startup.
//
// Player flow:
//   enterStage(stageId)  — leave any current stage, install a new
//                          StageController Tickable, spawn the initial pop.
//   startFight()         — install a CombatActivity bound to current stage.
//   startGather(nodeId)  — install a GatherActivity bound to that node.
//   stopActivity()       — signal current activity to wind down.
//   leaveStage()         — drop stage controller and despawn everything.
//
// Save integration:
//   - state is the source of truth.
//   - Stage session lives in state.currentStage; controller is re-instantiated
//     from it on load.
//   - Activity is a runtime Tickable; persisted form is PC.activity (kind +
//     resume data).

import { createTickEngine, TICK_MS } from "../core/tick";
import { createGameEventBus } from "../core/events";
import { createRng, restoreRng } from "../core/rng";
import { createEmptyState, type GameState, type WorldRecord } from "../core/state";
import { setContent, type ContentDb } from "../core/content";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  createCombatActivity,
  createGatherActivity,
  type CombatActivity,
  type CombatActivityPhase,
  type GatherActivity,
} from "../core/activity";
import {
  createPlayerCharacter,
  getAttr,
  isPlayer,
  rebuildCharacterDerived,
  type PlayerCharacter,
} from "../core/actor";
import { ATTR } from "../core/attribute";
import { registerBuiltinIntents } from "../core/intent";
import {
  enterStage as enterStageCore,
  leaveStage as leaveStageCore,
  type StageController,
} from "../core/stage";
import {
  deserialize,
  LocalStorageSaveAdapter,
  serialize,
  type SaveAdapter,
} from "../core/save";
import {
  createInventory,
  DEFAULT_CHAR_INVENTORY_CAPACITY,
} from "../core/inventory";
import {
  basicAttack,
  copperMine,
  defaultCharXpCurve,
  forestLv1,
} from "../content";
import { upgradeCost } from "../core/worldrecord";

const SAVE_KEY = "yaia:save";
const AUTOSAVE_INTERVAL_MS = 10_000;

export interface GameStore {
  readonly state: GameState;
  readonly activity: CombatActivity | GatherActivity | null;
  /** Stage the player is currently in (echoes state.currentStage.stageId). */
  readonly stageId: string | null;
  subscribe(cb: () => void): () => void;
  getRevision(): number;
  /** Ids of all stages available in the content db. */
  listStageIds(): string[];
  /** Switch stages. Stops current activity, leaves current stage, enters new. */
  enterStage(stageId: string): void;
  leaveStage(): void;
  /** Start a fight in the current stage. */
  startFight(): void;
  /** Start gathering a specific resource node in the current stage. */
  startGather(nodeId: string): void;
  /** Stop whatever activity is running. */
  stopActivity(): void;
  clearSaveAndReset(): Promise<void>;
  getHero(): PlayerCharacter | null;
  isRunning(): boolean;
  setSpeedMultiplier(mul: number): void;
  getSpeedMultiplier(): number;
  /** Current currency balances (e.g. state.currencies["currency.gold"]). */
  getCurrencies(): Record<string, number>;
  /** Current WorldRecord (upgrade levels). */
  getWorldRecord(): WorldRecord;
  /** Ids of all upgrades available in the content db. */
  listUpgradeIds(): string[];
  /** Purchase the next level of an upgrade. No-ops if the player lacks funds
   *  or the upgrade is already at max level. */
  purchaseUpgrade(upgradeId: string): void;
  dispose(): void;
}

export interface CreateGameStoreOptions {
  content: ContentDb;
  seed?: number;
  saveAdapter?: SaveAdapter;
  /** If true, attempt to load on startup. Default: true. */
  autoLoad?: boolean;
}

// ---------- Serialized activity pointers ----------

interface CombatActivityData extends Record<string, unknown> {
  phase: CombatActivityPhase;
  currentBattleId: string | null;
  lastTransitionTick: number;
}

interface GatherActivityData extends Record<string, unknown> {
  nodeId: string;
  progressTicks: number;
  swingsCompleted: number;
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
  let activity: CombatActivity | GatherActivity | null = null;
  let stageController: StageController | null = null;
  let revision = 0;
  const subs = new Set<() => void>();

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
  bus.on("loot", notify);
  bus.on("activityComplete", () => {
    activity = null;
    const hero = getHeroInternal();
    if (hero) hero.activity = null;
    notify();
    persistSoon();
  });

  const stopLoop = engine.start();

  // ---------- Helpers ----------

  function getHeroInternal(): PlayerCharacter | null {
    const h = state.actors.find((a) => a.kind === "player");
    return h ? (h as PlayerCharacter) : null;
  }

  function ensureHero(): PlayerCharacter {
    let hero = getHeroInternal();
    if (!hero) {
      hero = createPlayerCharacter({
        id: "hero.1",
        name: "Hero",
        xpCurve: defaultCharXpCurve,
        knownAbilities: [basicAttack.id],
        attrDefs,
      });
      state.actors.push(hero);
      // A fresh hero needs a personal inventory grid. The shared bag is
      // created by createEmptyState; per-char bags live at state.inventories[heroId].
      if (!state.inventories[hero.id]) {
        state.inventories[hero.id] = createInventory(
          DEFAULT_CHAR_INVENTORY_CAPACITY,
        );
      }
    }
    return hero;
  }

  function buildCtx() {
    return {
      state,
      bus,
      rng,
      attrDefs,
      currentTick: engine.currentTick,
    };
  }

  /** Flip a running activity into "done" and pull it off the engine. */
  function stopRunningActivity(): void {
    if (!activity) return;
    if (activity.kind === ACTIVITY_COMBAT_KIND) activity.phase = "stopped";
    else if (activity.kind === ACTIVITY_GATHER_KIND) activity.stopRequested = true;
    engine.unregister(activity.id);
    activity = null;
    const hero = getHeroInternal();
    if (hero) hero.activity = null;
  }

  function syncActivityPointer(): void {
    const hero = getHeroInternal();
    if (!hero) return;
    if (!activity) {
      hero.activity = null;
      return;
    }
    if (activity.kind === ACTIVITY_COMBAT_KIND) {
      if (activity.phase === "stopped") {
        hero.activity = null;
        return;
      }
      const data: CombatActivityData = {
        phase: activity.phase,
        currentBattleId: activity.currentBattleId,
        lastTransitionTick: activity.lastTransitionTick,
      };
      hero.activity = {
        kind: ACTIVITY_COMBAT_KIND,
        startedAtTick: activity.startedAtTick,
        data,
      };
    } else if (activity.kind === ACTIVITY_GATHER_KIND) {
      if (activity.stopRequested) {
        hero.activity = null;
        return;
      }
      const data: GatherActivityData = {
        nodeId: activity.nodeId,
        progressTicks: activity.progressTicks,
        swingsCompleted: activity.swingsCompleted,
      };
      hero.activity = {
        kind: ACTIVITY_GATHER_KIND,
        startedAtTick: activity.startedAtTick,
        data,
      };
    }
  }

  // ---------- Stage ----------

  function enterStage(stageId: string): void {
    // Stop any activity + leave current stage first.
    stopRunningActivity();
    if (stageController) {
      engine.unregister(stageController.id);
      leaveStageCore(buildCtx());
      stageController = null;
    }

    ensureHero();
    stageController = enterStageCore({
      stageId,
      ctxProvider: buildCtx,
    });
    engine.register(stageController);
    notify();
    persistSoon();
  }

  function leaveStage(): void {
    stopRunningActivity();
    if (stageController) {
      engine.unregister(stageController.id);
      leaveStageCore(buildCtx());
      stageController = null;
    }
    notify();
    persistSoon();
  }

  // ---------- Activities ----------

  function startFight(): void {
    if (!state.currentStage) {
      console.warn("startFight: not in a stage");
      return;
    }
    stopRunningActivity();
    const hero = ensureHero();
    hero.currentHp = getAttr(hero, ATTR.MAX_HP, attrDefs);
    hero.currentMp = getAttr(hero, ATTR.MAX_MP, attrDefs);
    hero.activeEffects = [];
    hero.cooldowns = {};

    activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider: buildCtx,
      actionDelayTicks: 8,
      recoverHpPctPerTick: 0.02,
    });
    engine.register(activity);
    syncActivityPointer();
    notify();
    persistSoon();
  }

  function startGather(nodeId: string): void {
    if (!state.currentStage) {
      console.warn("startGather: not in a stage");
      return;
    }
    stopRunningActivity();
    const hero = ensureHero();
    activity = createGatherActivity({
      ownerCharacterId: hero.id,
      nodeId,
      ctxProvider: buildCtx,
    });
    engine.register(activity);
    syncActivityPointer();
    notify();
    persistSoon();
  }

  // ---------- Rehydrate after load ----------

  /** Rebuild the stage controller from a persisted session. */
  function rehydrateStage(): void {
    if (!state.currentStage) return;
    stageController = enterStageCore({
      stageId: state.currentStage.stageId,
      ctxProvider: buildCtx,
      resume: true,
    });
    engine.register(stageController);
  }

  /** Rebuild an activity after loading a save that had one in-flight. */
  function rehydrateActivity(): void {
    const hero = getHeroInternal();
    if (!hero || !hero.activity) return;
    if (hero.activity.kind === ACTIVITY_COMBAT_KIND) {
      const data = hero.activity.data as CombatActivityData;
      activity = createCombatActivity({
        ownerCharacterId: hero.id,
        ctxProvider: buildCtx,
        actionDelayTicks: 8,
        recoverHpPctPerTick: 0.02,
        resume: {
          phase: data.phase,
          currentBattleId: data.currentBattleId,
          lastTransitionTick: data.lastTransitionTick,
        },
      });
      if (activity.phase !== "stopped") engine.register(activity);
    } else if (hero.activity.kind === ACTIVITY_GATHER_KIND) {
      const data = hero.activity.data as GatherActivityData;
      activity = createGatherActivity({
        ownerCharacterId: hero.id,
        nodeId: data.nodeId,
        ctxProvider: buildCtx,
        resume: { progressTicks: data.progressTicks },
      });
      engine.register(activity);
    }
  }

  async function tryLoad(): Promise<boolean> {
    try {
      const raw = await adapter.load(SAVE_KEY);
      if (!raw) return false;
      const loaded = deserialize(raw, { attrDefs });
      state = loaded;
      rng = restoreRng(loaded.rngState);
      engine.setTick(loaded.tick);
      rehydrateStage();
      rehydrateActivity();
      notify();
      return true;
    } catch (e) {
      console.error("load failed; continuing with a fresh state:", e);
      return false;
    }
  }

  // ---------- Public API ----------

  const store: GameStore = {
    get state() {
      return state;
    },
    get activity() {
      return activity;
    },
    get stageId() {
      return state.currentStage?.stageId ?? null;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getRevision: () => revision,
    listStageIds: () => Object.keys(opts.content.stages),
    enterStage,
    leaveStage,
    startFight,
    startGather,
    getHero: getHeroInternal,
    stopActivity() {
      stopRunningActivity();
      notify();
      persistSoon();
    },
    async clearSaveAndReset() {
      stopRunningActivity();
      if (stageController) {
        engine.unregister(stageController.id);
        stageController = null;
      }
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
    isRunning(): boolean {
      if (!activity) return false;
      if (activity.kind === ACTIVITY_COMBAT_KIND) return activity.phase !== "stopped";
      if (activity.kind === ACTIVITY_GATHER_KIND) return !activity.stopRequested;
      return false;
    },
    setSpeedMultiplier(m) {
      engine.speedMultiplier = m;
      notify();
    },
    getSpeedMultiplier: () => engine.speedMultiplier,
    getCurrencies: () => state.currencies,
    getWorldRecord: () => state.worldRecord,
    listUpgradeIds: () => Object.keys(opts.content.upgrades),
    purchaseUpgrade(upgradeId: string) {
      const def = opts.content.upgrades[upgradeId];
      if (!def) throw new Error(`purchaseUpgrade: unknown upgrade "${upgradeId}"`);
      const currentLevel = state.worldRecord.upgrades[upgradeId] ?? 0;
      if (currentLevel >= def.maxLevel) return; // already maxed
      const cost = upgradeCost(def, currentLevel);
      const balance = state.currencies[def.costCurrency] ?? 0;
      if (balance < cost) return; // insufficient funds — caller should have gated via UI
      state.currencies[def.costCurrency] = balance - cost;
      state.worldRecord.upgrades[upgradeId] = currentLevel + 1;
      // Rebuild derived state for every PC so world modifiers take effect.
      for (const a of state.actors) {
        if (isPlayer(a)) rebuildCharacterDerived(a, attrDefs, state.worldRecord);
      }
      notify();
      persistSoon();
    },
    dispose() {
      stopLoop();
      if (pendingSaveTimer !== null) clearTimeout(pendingSaveTimer);
      subs.clear();
    },
  };

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
    void tryLoad().then((loaded) => {
      // If there was no save, pre-populate a new game with the hero + the
      // default starting stage so the UI isn't empty.
      if (!loaded) {
        ensureHero();
        enterStage(forestLv1.id);
      }
    });
  }

  // Silence "unused" warnings for imports only referenced above.
  void copperMine;

  return store;
}

export { TICK_MS };
