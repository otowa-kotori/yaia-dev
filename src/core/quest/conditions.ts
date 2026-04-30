// Quest condition evaluation and reevalOn event derivation.
//
// These are pure functions operating on GameState snapshots. They have no
// side effects and no runtime dependencies beyond the state and the unlock
// helper for flag-key translation.

import type { GameState } from "../infra/state/types";
import type { GameEvents } from "../infra/events";
import type { QuestCondition } from "../content/types";
import { isPlayer, type Actor } from "../entity/actor/types";
import { toUnlockFlagKey } from "../growth/unlock";

/**
 * Evaluate a QuestCondition against the current GameState.
 * Returns true if the condition is satisfied.
 */
export function evaluateQuestCondition(
  condition: QuestCondition,
  state: GameState,
): boolean {
  switch (condition.type) {
    case "questCompleted":
      return state.quests[condition.questId as string]?.status === "completed";

    case "playerLevel": {
      // Any player hero with level >= min satisfies.
      return state.actors.some(
        (a: Actor) => isPlayer(a) && a.level >= condition.min,
      );
    }

    case "isUnlocked":
      return (state.flags[toUnlockFlagKey(condition.unlockId)] ?? 0) > 0;

    case "hasFlag": {
      const val = state.flags[condition.flagId] ?? 0;
      return condition.value !== undefined ? val >= condition.value : val > 0;
    }

    case "hasItem": {
      // Sum item quantity across all inventories.
      let total = 0;
      for (const inv of Object.values(state.inventories)) {
        for (const slot of inv.slots) {
          if (!slot) continue;
          if (slot.kind === "stack" && slot.itemId === condition.itemId) {
            total += slot.qty;
          } else if (slot.kind === "gear" && slot.instance.itemId === condition.itemId) {
            total += 1;
          }
        }
      }
      return total >= condition.qty;
    }

    case "hasCurrency":
      return (state.currencies[condition.currencyId] ?? 0) >= condition.amount;

    default: {
      // Exhaustiveness check — TypeScript narrows to `never` here.
      const _exhaustive: never = condition;
      throw new Error(`evaluateQuestCondition: unknown condition type: ${(_exhaustive as QuestCondition).type}`);
    }
  }
}

/**
 * Derive which GameEvent types might cause a QuestCondition's truth value to
 * change. Used by the QuestTracker to know when to re-evaluate state-type
 * objectives and prerequisite checks.
 */
export function deriveReevalEvents(
  condition: QuestCondition,
): (keyof GameEvents)[] {
  switch (condition.type) {
    case "questCompleted":
      return ["questCompleted"];

    case "playerLevel":
      return ["levelup"];

    case "isUnlocked":
      return ["unlocked"];

    case "hasFlag":
      // Flags can be written by many systems; cover the common triggers.
      return ["questCompleted", "questAccepted"];

    case "hasItem":
      return [
        "loot",
        "inventoryChanged",
        "inventoryDiscarded",
        "pendingLootPicked",
        "crafted",
      ];

    case "hasCurrency":
      return ["currencyChanged"];

    default: {
      const _exhaustive: never = condition;
      throw new Error(`deriveReevalEvents: unknown condition type: ${(_exhaustive as QuestCondition).type}`);
    }
  }
}
