import type {
  CharacterController,
  FocusedCharacterBridge,
} from "./types";

/**
 * Build a focused-character bridge without Proxy magic.
 *
 * We keep the surface identical to CharacterController, but resolve the latest
 * focused controller lazily on every access. The implementation stays explicit
 * so TypeScript signatures remain stable and stack traces stay readable.
 */
export function createFocusedCharacterBridge(
  getCurrent: () => CharacterController,
): FocusedCharacterBridge {
  return {
    get hero() {
      return getCurrent().hero;
    },
    get activity() {
      return getCurrent().activity;
    },
    get stageSession() {
      return getCurrent().stageSession;
    },
    isRunning() {
      return getCurrent().isRunning();
    },
    enterLocation(locationId: string) {
      getCurrent().enterLocation(locationId);
    },
    leaveLocation() {
      getCurrent().leaveLocation();
    },
    startFight(combatZoneId: string) {
      getCurrent().startFight(combatZoneId);
    },
    startGather(nodeId: string) {
      getCurrent().startGather(nodeId);
    },
    stopActivity() {
      getCurrent().stopActivity();
    },
    equipItem(slotIndex: number) {
      getCurrent().equipItem(slotIndex);
    },
    unequipItem(slot: string) {
      getCurrent().unequipItem(slot);
    },
    discardInventoryItem(inventoryOwnerId: string, slotIndex: number) {
      getCurrent().discardInventoryItem(inventoryOwnerId, slotIndex);
    },
    storeItemInShared(slotIndex: number) {
      getCurrent().storeItemInShared(slotIndex);
    },
    takeItemFromShared(slotIndex: number) {
      getCurrent().takeItemFromShared(slotIndex);
    },
    craftRecipe(recipeId: string) {
      getCurrent().craftRecipe(recipeId);
    },
    pickUpPendingLoot(index: number) {
      return getCurrent().pickUpPendingLoot(index);
    },
    pickUpAllPendingLoot() {
      return getCurrent().pickUpAllPendingLoot();
    },
    allocateTalent(talentId: string) {
      getCurrent().allocateTalent(talentId);
    },
    equipTalent(talentId: string) {
      getCurrent().equipTalent(talentId);
    },
    unequipTalent(talentId: string) {
      getCurrent().unequipTalent(talentId);
    },
  };
}
