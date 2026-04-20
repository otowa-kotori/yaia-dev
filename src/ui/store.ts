// Minimal bridge between game-core and React UI.
//
// Responsibilities:
// - Own the TickEngine, bus, rng, state, and live combat activity (if any).
// - Expose a trivial subscribe(callback) API for UI.
// - Publish a "revision number" that bumps every UI-visible mutation, so React
//   can re-render without deep equality checks.

import { createTickEngine, TICK_MS } from "../core/tick";
import { createGameEventBus } from "../core/events";
import { createRng } from "../core/rng";
import { createEmptyState, type GameState } from "../core/state";
import { setContent, type ContentDb } from "../core/content";
import {
  createCombatActivity,
  type CombatActivity,
} from "../core/activity";
import { createPlayerCharacter, getAttr, type PlayerCharacter } from "../core/actor";
import { basicAttack, defaultCharXpCurve, forestLv1 } from "../content";

export interface GameStore {
  readonly state: GameState;
  readonly activity: CombatActivity | null;
  subscribe(cb: () => void): () => void;
  getRevision(): number;
  startDemoBattle(): void;
  stopActivity(): void;
  getHero(): PlayerCharacter | null;
  isRunning(): boolean;
  setSpeedMultiplier(mul: number): void;
  getSpeedMultiplier(): number;
  dispose(): void;
}

export interface CreateGameStoreOptions {
  content: ContentDb;
  seed?: number;
}

export function createGameStore(opts: CreateGameStoreOptions): GameStore {
  setContent(opts.content);
  const seed = opts.seed ?? 42;

  const state = createEmptyState(seed, 1);
  const bus = createGameEventBus();
  const rng = createRng(seed);
  const engine = createTickEngine({ initialSpeedMultiplier: 1 });
  let activity: CombatActivity | null = null;
  let revision = 0;
  const subs = new Set<() => void>();

  function notify(): void {
    revision += 1;
    state.tick = engine.currentTick;
    state.rngState = rng.state;
    for (const cb of [...subs]) cb();
  }

  // One UI-notifier tickable; runs every logic tick so HP bars / logs stay
  // fresh. Registered first so it runs before domain tickables, but since we
  // notify at end-of-tick that ordering doesn't matter for correctness.
  engine.register({ id: "__ui_notifier", tick: () => notify() });

  // Also bump on specific domain events so the UI can refresh mid-tick.
  bus.on("damage", notify);
  bus.on("kill", notify);
  bus.on("levelup", notify);
  bus.on("activityComplete", () => {
    activity = null;
    notify();
  });

  const stopLoop = engine.start();

  const attrDefs = opts.content.attributes;

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

  const store: GameStore = {
    state,
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
    startDemoBattle() {
      if (activity && activity.phase !== "stopped") return;

      const hero = ensureHero();
      // Heal the hero between sessions — only ever up to their actual maxHp.
      hero.activeEffects = [];
      hero.cooldowns = {};
      hero.currentHp = getAttr(hero, "attr.max_hp", attrDefs);
      hero.currentMp = getAttr(hero, "attr.max_mp", attrDefs);

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
      notify();
    },
    stopActivity() {
      if (activity) activity.stopRequested = true;
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
      subs.clear();
    },
  };

  if (typeof window !== "undefined") {
    (window as unknown as { __game: GameStore }).__game = store;
  }

  return store;
}

export { TICK_MS };
