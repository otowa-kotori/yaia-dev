// GameSession — runtime orchestrator for the game-core.
//
// Responsibilities:
// - Own the live runtime graph: tick engine, event bus, rng, state, stage
//   controller, and the active character activity.
// - Expose gameplay commands (enterLocation, startFight, startGather, …) as
//   direct methods. These methods encode the rules for each action.
// - Take a ContentDb and optional seed; nothing else.
//
// Location / Entry / Instance flow:
//   1. enterLocation(locationId) — set state.currentLocationId, stop any
//      running activity + instance. No actors are spawned yet.
//   2. startFight(encounterId) — create a StageSession + StageController for
//      the chosen combat entry. Spawn first wave. Create CombatActivity.
//   3. startGather(nodeId) — create a StageSession + StageController for
//      the chosen gather entry. Spawn resource nodes. Create GatherActivity.
//   4. stopActivity / leaveLocation — tear down in reverse.
//
// What it is NOT:
// - Not a React bridge. It does not publish a revision counter, does not
//   manage subscriptions, does not schedule autosave. Those live in the UI
//   Store adapter (src/ui/store.ts).
// - Not a save adapter. It exposes loadFromSave(state) / resetToFresh() as
//   lifecycle hooks; the Store decides when/how to persist.
//
// Runtime object lifetime:
// - The tick engine is created once and lives until dispose(). Internal
//   state (state, rng, stageController, activity) is replaced in place on
//   loadFromSave / resetToFresh; public getters always see the latest.
// - buildCtx() closes over those slots so Activity/StageController callbacks
//   always receive the current runtime graph even after a reload.
//
// No Math.random / no setInterval inside gameplay paths — everything flows
// through ctx.rng and the tick engine, per the project invariants.

import { createTickEngine, type TickEngine } from "../tick";
import { createGameEventBus, type GameEventBus } from "../events";
import { createRng, restoreRng, type Rng } from "../rng";
import {
  createEmptyState,
  type GameState,
} from "../state";
import type { ContentDb } from "../content";
import { getLocation, setContent } from "../content";
import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  createCombatActivity,
  createGatherActivity,
  type CombatActivity,
  type CombatActivityPhase,
  type GatherActivity,
} from "../activity";
import {
  createPlayerCharacter,
  isPlayer,
  isResourceNode,
  type PlayerCharacter,
} from "../actor";
import { registerBuiltinIntents } from "../intent";
import {
  enterStage as enterStageCore,
  leaveStage as leaveStageCore,
  type StageController,
} from "../stage";
import {
  createInventory,
  DEFAULT_CHAR_INVENTORY_CAPACITY,
} from "../inventory";

// ---------- Persisted activity pointers ----------
// The resume payload stored in PlayerCharacter.activity.data. Mirrored in
// combat.ts / gather.ts and read here only during rehydrateActivity.

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

// ---------- Public interface ----------

export interface GameSession {
  // Data exposure (read-only for the UI). These are live getters; the
  // backing slots are replaced on loadFromSave / resetToFresh.
  readonly state: GameState;
  readonly activity: CombatActivity | GatherActivity | null;
  readonly locationId: string | null;

  // Runtime handles the Store (or any adapter) needs to wire up its own
  // side effects. Stable across reloads.
  readonly engine: TickEngine;
  readonly bus: GameEventBus;

  // Gameplay commands.
  enterLocation(locationId: string): void;
  leaveLocation(): void;
  startFight(encounterId: string): void;
  startGather(nodeId: string): void;
  stopActivity(): void;

  // Queries.
  getHero(): PlayerCharacter | null;
  isRunning(): boolean;
  setSpeedMultiplier(mul: number): void;
  getSpeedMultiplier(): number;

  // Lifecycle hooks. The Store owns persistence; these methods replace the
  // in-memory graph but do not touch any save adapter.
  /** Swap in a freshly deserialized GameState. Rehydrates stage + activity. */
  loadFromSave(loaded: GameState): void;
  /** Reset to a brand-new game using content.starting. Installs the hero,
   *  seeds an empty inventory, and enters the initial location. Throws if
   *  content.starting is missing. */
  resetToFresh(): void;

  dispose(): void;
}

export interface CreateGameSessionOptions {
  content: ContentDb;
  /** Deterministic seed. Default 42. */
  seed?: number;
}

// ---------- Factory ----------

export function createGameSession(
  opts: CreateGameSessionOptions,
): GameSession {
  setContent(opts.content);
  registerBuiltinIntents();

  const content = opts.content;
  const seed = opts.seed ?? 42;
  const attrDefs = content.attributes;

  // --- Mutable runtime slots. These are swapped on reload. buildCtx always
  //     closes over the current values through the `state` / `rng` bindings.
  let state: GameState = createEmptyState(seed, 1);
  let rng: Rng = createRng(seed);
  const bus = createGameEventBus();
  const engine = createTickEngine({ initialSpeedMultiplier: 1 });
  let activity: CombatActivity | GatherActivity | null = null;
  let stageController: StageController | null = null;

  // The engine runs in real time; Store attaches __ui_notifier on top.
  const stopLoop = engine.start();

  // Activity self-completion cleanup.
  bus.on("activityComplete", () => {
    activity = null;
  });

  // ---------- Context builder ----------

  function buildCtx() {
    return {
      state,
      bus,
      rng,
      attrDefs,
      currentTick: engine.currentTick,
    };
  }

  // ---------- Hero helpers ----------

  function getHeroInternal(): PlayerCharacter | null {
    const h = state.actors.find((a) => isPlayer(a));
    return h ? (h as PlayerCharacter) : null;
  }

  function ensureHeroFromContent(): PlayerCharacter {
    const existing = getHeroInternal();
    if (existing) return existing;
    const starting = content.starting;
    if (!starting) {
      throw new Error(
        "session.resetToFresh: content.starting is not configured; " +
          "set ContentDb.starting before booting a new game",
      );
    }
    const hero = createPlayerCharacter({
      id: starting.hero.id,
      name: starting.hero.name,
      xpCurve: starting.hero.xpCurve,
      knownAbilities: starting.hero.knownAbilities.slice(),
      attrDefs,
    });
    state.actors.push(hero);
    if (!state.inventories[hero.id]) {
      state.inventories[hero.id] = createInventory(
        starting.hero.inventoryCapacity ?? DEFAULT_CHAR_INVENTORY_CAPACITY,
      );
    }
    return hero;
  }

  // ---------- Activity lifecycle ----------

  function stopRunningActivity(): void {
    if (!activity) return;
    if (activity.kind === ACTIVITY_COMBAT_KIND) activity.phase = "stopped";
    else if (activity.kind === ACTIVITY_GATHER_KIND) activity.stopRequested = true;
    engine.unregister(activity.id);
    activity = null;
    const hero = getHeroInternal();
    if (hero) hero.activity = null;
  }

  // ---------- Instance (stage) lifecycle ----------

  function tearDownInstance(): void {
    stopRunningActivity();
    if (stageController) {
      engine.unregister(stageController.id);
      leaveStageCore(buildCtx());
      stageController = null;
    }
  }

  function startInstance(opts: {
    locationId: string;
    encounterId?: string | null;
    resourceNodes?: string[];
  }): void {
    tearDownInstance();
    ensureHeroFromContent();
    stageController = enterStageCore({
      locationId: opts.locationId,
      encounterId: opts.encounterId,
      resourceNodes: opts.resourceNodes,
      ctxProvider: buildCtx,
    });
    engine.register(stageController);
  }

  function findSpawnedResourceNodeActorId(defId: string): string {
    const session = state.currentStage;
    if (!session) {
      throw new Error(
        `session.startGather: no active instance while resolving node "${defId}"`,
      );
    }
    for (const actorId of session.spawnedActorIds) {
      const actor = state.actors.find((a) => a.id === actorId);
      if (actor && isResourceNode(actor) && actor.defId === defId) {
        return actor.id;
      }
    }
    throw new Error(
      `session.startGather: spawned instance has no resource node for def "${defId}"`,
    );
  }

  // ---------- Location ----------

  function enterLocation(locationId: string): void {
    // Validate the location exists in content.
    getLocation(locationId);
    tearDownInstance();
    state.currentLocationId = locationId;
  }

  function leaveLocation(): void {
    tearDownInstance();
    state.currentLocationId = null;
  }

  // ---------- Activities ----------

  function startFight(encounterId: string): void {
    if (!state.currentLocationId) {
      console.warn("session.startFight: not in a location");
      return;
    }
    startInstance({
      locationId: state.currentLocationId,
      encounterId,
    });
    const hero = ensureHeroFromContent();
    activity = createCombatActivity({
      ownerCharacterId: hero.id,
      ctxProvider: buildCtx,
    });
    activity.onStart?.(buildCtx());
    engine.register(activity);
  }

  function startGather(nodeDefId: string): void {
    if (!state.currentLocationId) {
      console.warn("session.startGather: not in a location");
      return;
    }
    startInstance({
      locationId: state.currentLocationId,
      resourceNodes: [nodeDefId],
    });
    const hero = ensureHeroFromContent();
    const nodeActorId = findSpawnedResourceNodeActorId(nodeDefId);
    activity = createGatherActivity({
      ownerCharacterId: hero.id,
      nodeId: nodeActorId,
      ctxProvider: buildCtx,
    });
    engine.register(activity);
  }

  function stopActivity(): void {
    tearDownInstance();
  }

  // ---------- Rehydrate after load ----------

  function rehydrateStage(): void {
    if (!state.currentStage) return;
    stageController = enterStageCore({
      locationId: state.currentStage.locationId,
      encounterId: state.currentStage.encounterId,
      ctxProvider: buildCtx,
      resume: true,
    });
    engine.register(stageController);
  }

  function rehydrateActivity(): void {
    const hero = getHeroInternal();
    if (!hero || !hero.activity) return;
    if (hero.activity.kind === ACTIVITY_COMBAT_KIND) {
      const data = hero.activity.data as CombatActivityData;
      activity = createCombatActivity({
        ownerCharacterId: hero.id,
        ctxProvider: buildCtx,
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

  // ---------- Public lifecycle ----------

  function loadFromSave(loaded: GameState): void {
    if (stageController) {
      engine.unregister(stageController.id);
      stageController = null;
    }
    if (activity) {
      engine.unregister(activity.id);
      activity = null;
    }
    state = loaded;
    rng = restoreRng(loaded.rngState);
    engine.setTick(loaded.tick);
    rehydrateStage();
    rehydrateActivity();
  }

  function resetToFresh(): void {
    tearDownInstance();
    state = createEmptyState(seed, 1);
    rng = createRng(seed);
    engine.setTick(0);
    const starting = content.starting;
    if (!starting) {
      throw new Error(
        "session.resetToFresh: content.starting is not configured",
      );
    }
    ensureHeroFromContent();
    enterLocation(starting.initialLocationId);
  }

  // ---------- Speed ----------

  function setSpeedMultiplier(mul: number): void {
    engine.speedMultiplier = mul;
  }

  function getSpeedMultiplier(): number {
    return engine.speedMultiplier;
  }

  // ---------- Public API ----------

  const session: GameSession = {
    get state() {
      state.tick = engine.currentTick;
      state.rngState = rng.state;
      return state;
    },
    get activity() {
      return activity;
    },
    get locationId() {
      return state.currentLocationId;
    },
    get engine() {
      return engine;
    },
    get bus() {
      return bus;
    },
    enterLocation,
    leaveLocation,
    startFight,
    startGather,
    stopActivity,
    getHero: getHeroInternal,
    isRunning(): boolean {
      if (!activity) return false;
      if (activity.kind === ACTIVITY_COMBAT_KIND) return activity.phase !== "stopped";
      if (activity.kind === ACTIVITY_GATHER_KIND) return !activity.stopRequested;
      return false;
    },
    setSpeedMultiplier,
    getSpeedMultiplier,
    loadFromSave,
    resetToFresh,
    dispose() {
      stopLoop();
    },
  };

  return session;
}
