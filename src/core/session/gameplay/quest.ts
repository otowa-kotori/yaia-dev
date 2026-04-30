// Session gameplay — quest commands.
//
// Wraps QuestTracker as the public API surface for GameSession.
// Injects the executeAction callback so the tracker can trigger unlock,
// setFlag, startQuest, etc. without depending on the session layer directly.

import type { QuestInstance } from "../../infra/state/types";
import type { GameAction } from "../../content/types";
import { createQuestTracker, type QuestTracker } from "../../quest";
import { unlock as unlockCore } from "../../growth/unlock";
import { grantRewards } from "../../economy/reward";
import { isPlayer } from "../../entity/actor/types";
import type { SessionRuntime } from "../types";

export interface QuestGameplay {
  acceptQuest(questId: string): void;
  abandonQuest(questId: string): void;
  turnInQuest(questId: string): void;
  getAvailableQuests(): string[];
  getActiveQuests(): QuestInstance[];
  getQuestInstance(questId: string): QuestInstance | undefined;
  debugForceCompleteQuest(questId: string): void;
  /** Internal: expose tracker for lifecycle hooks (reeval on load). */
  tracker: QuestTracker;
  /** Cleanup function returned by tracker.attach(). */
  dispose: () => void;
}

export function createQuestGameplay(runtime: SessionRuntime): QuestGameplay {
  // Action executor callback — delegates to session-level operations.
  function executeAction(action: GameAction): void {
    switch (action.type) {
      case "setFlag":
        runtime.state.flags[action.flagId] = action.value ?? 1;
        break;
      case "unlock": {
        const result = unlockCore(runtime.state, action.unlockId);
        if (result.changed) {
          runtime.bus.emit("unlocked", {
            unlockId: action.unlockId,
            source: "quest",
            tick: runtime.engine.currentTick,
          });
        }
        break;
      }
      case "grantReward": {
        // Grant reward to the focused character.
        const target = runtime.state.actors.find(
          (a) => a.id === runtime.state.focusedCharId,
        );
        if (target && isPlayer(target)) {
          grantRewards(action.reward, target, {
            state: runtime.state,
            bus: runtime.bus,
            rng: runtime.rng,
            currentTick: runtime.engine.currentTick,
            source: { kind: "other", id: "quest.action" },
          });
        }
        break;
      }
      case "startQuest":
        // Recursive call through tracker.
        tracker.accept(action.questId as string);
        break;
      case "turnInQuest":
        tracker.turnIn(action.questId as string);
        break;
    }
  }

  const tracker = createQuestTracker({
    getState: () => runtime.state,
    bus: runtime.bus,
    content: runtime.content,
    rng: runtime.rng,
    currentTick: () => runtime.engine.currentTick,
    executeAction,
  });

  const disposeTracker = tracker.attach();

  return {
    acceptQuest(questId) { tracker.accept(questId); },
    abandonQuest(questId) { tracker.abandon(questId); },
    turnInQuest(questId) { tracker.turnIn(questId); },
    getAvailableQuests() { return tracker.getAvailableQuests(); },
    getActiveQuests() { return tracker.getActiveQuests(); },
    getQuestInstance(questId) { return tracker.getInstance(questId); },
    debugForceCompleteQuest(questId) { tracker.forceComplete(questId); },
    tracker,
    dispose: disposeTracker,
  };
}
