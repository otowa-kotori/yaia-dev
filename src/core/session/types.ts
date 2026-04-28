import type { BattleSchedulerMode } from "../combat/battle";
import type { ContentDb } from "../content";
import type { PlayerCharacter } from "../entity/actor";
import type { GameEventBus } from "../infra/events";
import type { Rng } from "../infra/rng";
import type { GameState } from "../infra/state";
import type { TickEngine } from "../infra/tick";
import type {
  CombatActivity,
  DungeonActivity,
  GatherActivity,
} from "../world/activity";
import type { StageController } from "../world/stage";
import type { StageMode, StageSession } from "../world/stage/types";

// Persisted activity payloads mirrored from the world-activity layer and read
// here only while reconstructing runtime objects from a loaded save.

export interface CombatActivityData extends Record<string, unknown> {
  stageId: string;
  partyCharIds: string[];
  phase: CombatActivity["phase"];
  currentBattleId: string | null;
  lastTransitionTick: number;
}

export interface DungeonActivityData extends Record<string, unknown> {
  phase: DungeonActivity["phase"];
  currentBattleId: string | null;
  transitionTick: number;
}

export interface GatherActivityData extends Record<string, unknown> {
  nodeId: string;
  progressTicks: number;
  swingsCompleted: number;
}

/** Per-hero runtime handle. Exposes gameplay commands scoped to one character.
 *  Obtained via session.getCharacter(id), session.getFocusedCharacter(), or
 *  the higher-level session.focused bridge. */
export interface CharacterController {
  readonly hero: PlayerCharacter;
  readonly activity: CombatActivity | GatherActivity | null;
  /** Convenience getter: state.stages[hero.stageId] ?? null. */
  readonly stageSession: StageSession | null;

  isRunning(): boolean;
  enterLocation(locationId: string): void;
  leaveLocation(): void;
  /** Start solo combat (convenience wrapper for startPartyCombat with 1 hero). */
  startFight(combatZoneId: string): void;
  startGather(nodeId: string): void;
  stopActivity(): void;
  equipItem(slotIndex: number): void;
  unequipItem(slot: string): void;
  discardInventoryItem(inventoryOwnerId: string, slotIndex: number): void;
  storeItemInShared(slotIndex: number): void;
  takeItemFromShared(slotIndex: number): void;
  craftRecipe(recipeId: string): void;
  pickUpPendingLoot(index: number): boolean;
  pickUpAllPendingLoot(): number;
  allocateTalent(talentId: string): void;
  equipTalent(talentId: string): void;
  unequipTalent(talentId: string): void;
}

/**
 * Focused-character bridge for UI callers.
 *
 * It keeps the CharacterController surface but resolves the current focused
 * hero lazily on every access, so UI code can call session.focused.xxx()
 * without repeating getFocusedCharacter().
 */
export interface FocusedCharacterBridge extends CharacterController {}

export interface GameSession {
  readonly state: GameState;
  readonly engine: TickEngine;
  readonly bus: GameEventBus;
  readonly focusedCharId: string;
  readonly focused: FocusedCharacterBridge;

  // Character management.
  getCharacter(charId: string): CharacterController;
  getFocusedCharacter(): CharacterController;
  setFocusedChar(charId: string): void;
  listHeroes(): PlayerCharacter[];

  /** Start a dungeon run with the given party. All characters must be idle. */
  startDungeon(dungeonId: string, partyCharIds: string[]): void;
  /** Start a party combat session in a combat zone. All characters must be idle. */
  startPartyCombat(combatZoneId: string, partyCharIds: string[]): void;
  /** Abandon the currently active dungeon run for a character. No completion rewards. */
  abandonDungeon(charId: string): void;
  /** Purchase the next level of a global upgrade. */
  purchaseUpgrade(upgradeId: string): void;
  /** Check whether a feature/location/system unlock is active. */
  isUnlocked(unlockId: string): boolean;
  /** Unlock a feature/location/system id. Unknown unlock ids throw loudly. */
  unlock(unlockId: string, source?: string): boolean;
  /** List all currently unlocked ids. */
  listUnlocked(): string[];

  // Global commands.
  setSpeedMultiplier(mul: number): void;
  getSpeedMultiplier(): number;
  /** Debug/dev only: controls which scheduler future new battles will use. */
  setBattleSchedulerMode(mode: BattleSchedulerMode): void;
  getBattleSchedulerMode(): BattleSchedulerMode;
  /** Debug/dev only: grant whole character levels to a hero via the normal XP pipeline. */
  debugGrantHeroLevels(charId: string, levels: number): number;
  /** Debug/dev only: create items directly in a hero inventory. */
  debugGiveItem(charId: string, itemId: string, qty: number): void;

  // Lifecycle hooks. The Store owns persistence; these methods replace the
  // in-memory graph but do not touch any save adapter.
  loadFromSave(loaded: GameState): void;
  resetToFresh(): void;
  dispose(): void;
}

export interface CreateGameSessionOptions {
  content: ContentDb;
  /** Deterministic seed. Default 42. */
  seed?: number;
}

export type StageTeardownReason =
  | "player"
  | "left_location"
  | "switch_activity"
  | "system";

export interface SessionBuildCtx {
  state: GameState;
  bus: GameEventBus;
  rng: Rng;
  currentTick: number;
  battleSchedulerMode: BattleSchedulerMode;
}

export interface CharacterControllerImpl extends CharacterController {
  hero: PlayerCharacter;
  _activity: CombatActivity | GatherActivity | null;
}

export interface SessionRuntime {
  readonly content: ContentDb;
  readonly seed: number;
  state: GameState;
  rng: Rng;
  battleSchedulerMode: BattleSchedulerMode;
  readonly bus: GameEventBus;
  readonly engine: TickEngine;
  readonly characters: Map<string, CharacterControllerImpl>;
  readonly stageControllers: Map<string, StageController>;
  readonly dungeonActivities: Map<string, DungeonActivity>;
  readonly combatActivities: Map<string, CombatActivity>;
  stopLoop: () => void;
  disposeGameLogCollector: () => void;
  buildCtx(): SessionBuildCtx;
}

export interface CharacterCommandSet {
  enterLocation(cc: CharacterControllerImpl, locationId: string): void;
  leaveLocation(cc: CharacterControllerImpl): void;
  startFight(cc: CharacterControllerImpl, combatZoneId: string): void;
  startGather(cc: CharacterControllerImpl, nodeId: string): void;
  stopActivity(cc: CharacterControllerImpl): void;
  equipItem(cc: CharacterControllerImpl, slotIndex: number): void;
  unequipItem(cc: CharacterControllerImpl, slot: string): void;
  discardInventoryItem(
    cc: CharacterControllerImpl,
    inventoryOwnerId: string,
    slotIndex: number,
  ): void;
  storeItemInShared(cc: CharacterControllerImpl, slotIndex: number): void;
  takeItemFromShared(cc: CharacterControllerImpl, slotIndex: number): void;
  craftRecipe(cc: CharacterControllerImpl, recipeId: string): void;
  pickUpPendingLoot(cc: CharacterControllerImpl, index: number): boolean;
  pickUpAllPendingLoot(cc: CharacterControllerImpl): number;
  allocateTalent(cc: CharacterControllerImpl, talentId: string): void;
  equipTalent(cc: CharacterControllerImpl, talentId: string): void;
  unequipTalent(cc: CharacterControllerImpl, talentId: string): void;
}

export interface StartStageInstanceOptions {
  locationId: string;
  mode?: StageMode;
  resourceNodes?: string[];
}
