// GameSession — runtime orchestrator for the game-core.
//
// Two-layer architecture:
//   GameSession  — global layer: tick engine, bus, rng, state, lifecycle,
//                  speed, character management (getCharacter, listHeroes).
//   CharacterController — per-hero layer: gameplay commands (enterLocation,
//                  startFight, startGather, equipItem, craftRecipe, …).
//                  UI usually goes through session.focused; lower-level callers
//                  can still use getFocusedCharacter() / getCharacter(id).
//
// Stage instances live in state.stages (keyed by stageId). Each hero
// references its stage via hero.stageId. StageControllers are managed
// independently in a Map<stageId, StageController> — they are NOT owned
// by CharacterController, because in the future multiple heroes may share
// a stage (co-op dungeons).
//
// Location / Entry / Instance flow (per character):
//   1. cc.enterLocation(locationId) — set hero.locationId, stop any
//      running activity + stage instance. No actors are spawned yet.
//   2. cc.startFight(combatZoneId) — create a StageSession in state.stages,
//      set hero.stageId, spawn first wave, create CombatActivity.
//   3. cc.startGather(nodeId) — create a StageSession in state.stages,
//      set hero.stageId, spawn resource nodes, create GatherActivity.
//   4. cc.stopActivity / cc.leaveLocation — tear down in reverse.
//
// What it is NOT:
// - Not a React bridge. Revision counter, subscriptions, autosave live in
//   the UI Store adapter (src/ui/store.ts).
// - Not a save adapter. It exposes loadFromSave / resetToFresh as lifecycle
//   hooks; the Store decides when/how to persist.
//
// No Math.random / no setInterval inside gameplay paths — everything flows
// through ctx.rng and the tick engine, per the project invariants.

import { setContent } from "../content";
import { registerBuiltinIntents } from "../combat/intent";
import { createFocusedCharacterBridge } from "./bridge";
import { createCharacterController } from "./controller";
import { createCharacterGameplay } from "./gameplay/character";
import { createDungeonGameplay } from "./gameplay/dungeon";
import { createInventoryGameplay } from "./gameplay/inventory";
import { createPartyCombatGameplay } from "./gameplay/party-combat";
import { createProgressionGameplay } from "./gameplay/progression";
import { createSessionLifecycle } from "./lifecycle";
import { createSessionRuntime } from "./runtime";
import type {
  CharacterCommandSet,
  CharacterControllerImpl,
  CreateGameSessionOptions,
  GameSession,
} from "./types";

export type {
  CharacterController,
  CreateGameSessionOptions,
  FocusedCharacterBridge,
  GameSession,
} from "./types";

// ---------- Factory ----------

export function createGameSession(
  opts: CreateGameSessionOptions,
): GameSession {
  setContent(opts.content);
  registerBuiltinIntents();

  const runtime = createSessionRuntime(opts);
  const partyCombat = createPartyCombatGameplay(runtime);
  const dungeon = createDungeonGameplay(runtime);
  const progression = createProgressionGameplay(runtime);

  const characterCommands: CharacterCommandSet = {
    ...createCharacterGameplay(runtime, {
      startPartyCombat: partyCombat.startPartyCombat,
    }),
    ...createInventoryGameplay(runtime),
    ...progression.characterCommands,
  };

  const createController = (
    hero: CharacterControllerImpl["hero"],
  ): CharacterControllerImpl =>
    createCharacterController(hero, runtime, characterCommands);

  const lifecycle = createSessionLifecycle({
    runtime,
    createCharacterController: createController,
    restoreDungeonParty: dungeon.restoreDungeonParty,
    unlock: progression.unlock,
  });

  function getCharacter(charId: string) {
    const cc = runtime.characters.get(charId);
    if (!cc) {
      throw new Error(`session.getCharacter: no character with id "${charId}"`);
    }
    return cc;
  }

  function getFocusedCharacter() {
    return getCharacter(runtime.state.focusedCharId);
  }

  const focused = createFocusedCharacterBridge(getFocusedCharacter);

  const session: GameSession = {
    get state() {
      runtime.state.tick = runtime.engine.currentTick;
      runtime.state.rngState = runtime.rng.state;
      return runtime.state;
    },
    get engine() {
      return runtime.engine;
    },
    get bus() {
      return runtime.bus;
    },
    get focusedCharId() {
      return runtime.state.focusedCharId;
    },
    get focused() {
      return focused;
    },

    getCharacter,
    getFocusedCharacter,
    setFocusedChar(charId: string): void {
      if (!runtime.characters.has(charId)) {
        throw new Error(`session.setFocusedChar: no character with id "${charId}"`);
      }
      runtime.state.focusedCharId = charId;
    },
    listHeroes() {
      return Array.from(runtime.characters.values()).map((cc) => cc.hero);
    },

    startDungeon: dungeon.startDungeon,
    startPartyCombat: partyCombat.startPartyCombat,
    abandonDungeon: dungeon.abandonDungeon,
    purchaseUpgrade: progression.purchaseUpgrade,
    isUnlocked: progression.isUnlocked,
    unlock: progression.unlock,
    listUnlocked: progression.listUnlocked,

    setSpeedMultiplier(mul: number): void {
      runtime.engine.speedMultiplier = mul;
    },
    getSpeedMultiplier(): number {
      return runtime.engine.speedMultiplier;
    },
    setBattleSchedulerMode(mode): void {
      runtime.battleSchedulerMode = mode;
    },
    getBattleSchedulerMode() {
      return runtime.battleSchedulerMode;
    },
    debugGrantHeroLevels: progression.debugGrantHeroLevels,
    debugGiveItem: progression.debugGiveItem,

    loadFromSave: lifecycle.loadFromSave,
    resetToFresh: lifecycle.resetToFresh,
    dispose() {
      runtime.disposeGameLogCollector();
      runtime.stopLoop();
    },
  };

  return session;
}
