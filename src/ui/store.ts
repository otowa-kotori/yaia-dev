// Minimal bridge between game-core and React UI.
//
// Responsibilities:
// - Own the TickEngine, bus, rng, state, and live battle (if any).
// - Expose a trivial subscribe(callback) API for UI.
// - Publish a "revision number" that bumps every UI-visible mutation, so React
//   can re-render without deep equality checks.
//
// Intentionally NOT a Redux-style immutable store. Mutations happen in place
// inside core; Store just notifies.

import { createTickEngine, TICK_MS } from "../core/tick";
import { createGameEventBus } from "../core/events";
import { createRng } from "../core/rng";
import { createEmptyState, type GameState } from "../core/state";
import { setContent, type ContentDb } from "../core/content";
import {
  createBattle,
  type Battle,
  type TickBattleContext,
} from "../core/combat";
import { createCombatActivity } from "../core/activity";
import {
  createEnemy,
  createPlayerCharacter,
  type PlayerCharacter,
  type Enemy,
} from "../core/actor";
import { basicAttack, slime } from "../content";

export interface GameStore {
  readonly state: GameState;
  readonly battle: Battle | null;
  subscribe(cb: () => void): () => void;
  getRevision(): number;
  startDemoBattle(): void;
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
  let battle: Battle | null = null;
  let revision = 0;
  const subs = new Set<() => void>();

  function notify(): void {
    revision += 1;
    state.tick = engine.currentTick;
    state.rngState = rng.state;
    for (const cb of [...subs]) cb();
  }

  // Notify every time engine steps so the UI reflects current HPs. For MVP
  // we subscribe a "tick observer" tickable that bumps revision AFTER the rest
  // of the tickables have executed.
  engine.register({
    id: "__ui_notifier",
    tick: () => notify(),
  });

  // Also bump on specific domain events so the UI can refresh mid-tick logs.
  bus.on("damage", notify);
  bus.on("kill", notify);
  bus.on("activityComplete", () => {
    battle = null;
    notify();
  });

  const stopLoop = engine.start();

  const store: GameStore = {
    state,
    get battle() {
      return battle;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getRevision: () => revision,
    startDemoBattle() {
      if (battle && battle.outcome === "ongoing") return;

      // Clean up any leftover dead-body actors so the "demo" is fresh.
      state.actors = state.actors.filter((a) => {
        if (a.kind === "enemy") return false;
        return true;
      });

      // Reuse or create a single hero for the session.
      const attrDefs = opts.content.attributes;
      let hero = state.actors.find((a) => a.kind === "player") as
        | PlayerCharacter
        | undefined;
      if (!hero) {
        hero = createPlayerCharacter({
          id: "hero.1",
          name: "Hero",
          knownAbilities: [basicAttack.id],
          attrDefs,
        });
        state.actors.push(hero);
      } else {
        // Full-heal between demo battles.
        hero.currentHp = 999;
        hero.currentMp = 999;
        hero.activeEffects = [];
        hero.cooldowns = {};
      }

      const enemy: Enemy = createEnemy({
        instanceId: `enemy.slime.${engine.currentTick}`,
        def: slime,
        attrDefs,
      });
      state.actors.push(enemy);

      battle = createBattle({
        id: `battle.${engine.currentTick}`,
        mode: "solo",
        participantIds: [hero.id, enemy.id],
        actionDelayTicks: 8, // 800ms per action -> readable pacing
        startedAtTick: engine.currentTick,
      });

      const activity = createCombatActivity({
        ownerCharacterId: hero.id,
        battle,
        ctxProvider: (): TickBattleContext => ({
          state,
          bus,
          rng,
          attrDefs,
          currentTick: engine.currentTick,
        }),
      });
      engine.register(activity);
      notify();
    },
    isRunning: () => battle !== null && battle.outcome === "ongoing",
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

  // Expose for debugging in the browser devtools.
  if (typeof window !== "undefined") {
    (window as unknown as { __game: GameStore }).__game = store;
  }

  return store;
}

export { TICK_MS };
