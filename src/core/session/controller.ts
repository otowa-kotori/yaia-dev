import {
  ACTIVITY_COMBAT_KIND,
  ACTIVITY_GATHER_KIND,
  type CombatActivity,
  type GatherActivity,
} from "../world/activity";
import type { StageSession } from "../world/stage/types";
import type {
  CharacterCommandSet,
  CharacterControllerImpl,
  SessionRuntime,
} from "./types";

/**
 * CharacterController is now only a thin command/view bridge.
 *
 * All real gameplay work lives in dedicated gameplay services; the controller
 * just binds one hero to those services so callers can keep the ergonomic
 * per-character API.
 */
export function createCharacterController(
  hero: CharacterControllerImpl["hero"],
  runtime: SessionRuntime,
  commands: CharacterCommandSet,
): CharacterControllerImpl {
  const cc: CharacterControllerImpl = {
    hero,
    _activity: null,

    get activity() {
      return cc._activity;
    },

    get stageSession(): StageSession | null {
      return cc.hero.stageId ? runtime.state.stages[cc.hero.stageId] ?? null : null;
    },

    isRunning(): boolean {
      if (!cc._activity) return false;
      if (cc._activity.kind === ACTIVITY_COMBAT_KIND) {
        return (cc._activity as CombatActivity).phase !== "stopped";
      }
      if (cc._activity.kind === ACTIVITY_GATHER_KIND) {
        return !(cc._activity as GatherActivity).stopRequested;
      }
      return false;
    },

    enterLocation(locationId: string): void {
      commands.enterLocation(cc, locationId);
    },

    leaveLocation(): void {
      commands.leaveLocation(cc);
    },

    startFight(combatZoneId: string): void {
      commands.startFight(cc, combatZoneId);
    },

    startGather(nodeId: string): void {
      commands.startGather(cc, nodeId);
    },

    stopActivity(): void {
      commands.stopActivity(cc);
    },

    equipItem(slotIndex: number): void {
      commands.equipItem(cc, slotIndex);
    },

    unequipItem(slot: string): void {
      commands.unequipItem(cc, slot);
    },

    discardInventoryItem(inventoryOwnerId: string, slotIndex: number): void {
      commands.discardInventoryItem(cc, inventoryOwnerId, slotIndex);
    },

    storeItemInShared(slotIndex: number): void {
      commands.storeItemInShared(cc, slotIndex);
    },

    takeItemFromShared(slotIndex: number): void {
      commands.takeItemFromShared(cc, slotIndex);
    },

    craftRecipe(recipeId: string): void {
      commands.craftRecipe(cc, recipeId);
    },

    pickUpPendingLoot(index: number): boolean {
      return commands.pickUpPendingLoot(cc, index);
    },

    pickUpAllPendingLoot(): number {
      return commands.pickUpAllPendingLoot(cc);
    },

    allocateTalent(talentId: string): void {
      commands.allocateTalent(cc, talentId);
    },

    equipTalent(talentId: string): void {
      commands.equipTalent(cc, talentId);
    },

    unequipTalent(talentId: string): void {
      commands.unequipTalent(cc, talentId);
    },
  };

  return cc;
}
