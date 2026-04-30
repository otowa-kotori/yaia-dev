// QuestTracker — event-driven quest lifecycle manager.
//
// Not a Tickable. Subscribes to GameEvents and advances quest objectives when
// matching events fire. Manages: accept → track progress → ready → turnIn →
// completed, plus abandon and repeatable re-activation.
//
// The tracker does NOT directly depend on the session layer. It receives an
// `executeAction` callback injected by the session, keeping the dependency
// direction clean: session → quest (not quest → session).

import type { GameEvents, GameEventBus } from "../infra/events";
import type { GameState, QuestInstance } from "../infra/state/types";
import type {
  ContentDb,
  GameAction,
  QuestCondition,
  QuestDef,
  QuestId,
  QuestObjectiveDef,
  QuestObjectiveEvent,
  QuestObjectiveState,
} from "../content/types";
import type { Rng } from "../infra/rng";
import { evaluateQuestCondition, deriveReevalEvents } from "./conditions";
import { matchFilter } from "./filters";
import { checkCost, applyCost, type CostCheckContext } from "../economy/cost";
import { grantRewards, type GrantRewardsContext } from "../economy/reward";
import { isPlayer, type PlayerCharacter } from "../entity/actor/types";

// ---------- Public interface ----------

export interface QuestTrackerCtx {
  getState: () => GameState;
  bus: GameEventBus;
  content: ContentDb;
  rng: Rng;
  currentTick: () => number;
  /** Session-injected callback to execute GameActions (unlock, startQuest, etc). */
  executeAction: (action: GameAction) => void;
}

export interface QuestTracker {
  accept(questId: string, charId?: string): void;
  abandon(questId: string): void;
  turnIn(questId: string): void;
  forceComplete(questId: string): void;
  getAvailableQuests(): string[];
  getActiveQuests(): QuestInstance[];
  getInstance(questId: string): QuestInstance | undefined;
  /** Subscribe to bus events. Returns a cleanup function. */
  attach(): () => void;
  /** Full re-evaluation of state objectives + autoAccept check. Call after load. */
  reeval(): void;
}

// ---------- Factory ----------

export function createQuestTracker(ctx: QuestTrackerCtx): QuestTracker {
  const { bus, content, rng, getState, currentTick, executeAction } = ctx;

  // Active bus unsubscribe functions.
  const offs: Array<() => void> = [];

  // ---------- Helpers ----------

  function getQuestDef(questId: string): QuestDef {
    const def = content.quests[questId];
    if (!def) throw new Error(`quest: no quest "${questId}"`);
    return def;
  }

  function allObjectivesMet(instance: QuestInstance, def: QuestDef): boolean {
    return def.objectives.every((obj, i) => {
      const target = obj.kind === "event" ? obj.targetCount : 1;
      return (instance.progress[i] ?? 0) >= target;
    });
  }

  /** Check whether all prerequisites of a quest are satisfied. */
  function prerequisitesMet(def: QuestDef): boolean {
    if (!def.prerequisites || def.prerequisites.length === 0) return true;
    const state = getState();
    return def.prerequisites.every((c) => evaluateQuestCondition(c, state));
  }

  /** Resolve the PlayerCharacter that should receive quest rewards / pay costs. */
  function resolveTarget(instance: QuestInstance, state: GameState): PlayerCharacter {
    const targetId = instance.assignedCharId ?? state.focusedCharId;
    const actor = state.actors.find((a) => a.id === targetId);
    if (!actor || !isPlayer(actor)) {
      throw new Error(`quest: cannot resolve target character "${targetId}" for quest "${instance.questId}"`);
    }
    return actor as PlayerCharacter;
  }

  /** Whether a quest is eligible to be available (not active, not completed unless repeatable). */
  function isEligible(def: QuestDef): boolean {
    const state = getState();
    const instance = state.quests[def.id];
    if (!instance) return true; // never started
    if (instance.status === "active" || instance.status === "ready") return false;
    // completed — check repeatable
    if (instance.status === "completed") {
      if (!def.repeatable) return false;
      if (typeof def.repeatable === "object" && def.repeatable.cooldownTicks) {
        const elapsed = currentTick() - (instance.completedAtTick ?? 0);
        if (elapsed < def.repeatable.cooldownTicks) return false;
      }
      return true;
    }
    return false;
  }

  // ---------- Objective processing ----------

  /** Process an event for all active quests listening on that eventType. */
  function onEvent<K extends keyof GameEvents>(eventType: K, payload: GameEvents[K]): void {
    const state = getState();
    for (const instance of Object.values(state.quests)) {
      if (instance.status !== "active") continue;
      const def = content.quests[instance.questId];
      if (!def) continue;

      // Scope filter: character-scoped quests only count the assigned char's events.
      const charId = instance.assignedCharId;

      let changed = false;
      for (let i = 0; i < def.objectives.length; i++) {
        const obj = def.objectives[i]!;
        if (obj.kind === "event") {
          if (obj.eventType !== eventType) continue;
          // Scope check
          if (charId && "charId" in (payload as Record<string, unknown>)) {
            if ((payload as Record<string, unknown>).charId !== charId) continue;
          }
          // Filter check
          if (obj.filter && !matchFilter(obj.filter, payload as Record<string, unknown>)) continue;
          // Increment
          const increment = obj.incrementField
            ? Number((payload as Record<string, unknown>)[obj.incrementField] ?? 0)
            : 1;
          if (increment <= 0) continue;
          const prev = instance.progress[i] ?? 0;
          const next = Math.min(prev + increment, obj.targetCount);
          if (next === prev) continue;
          instance.progress[i] = next;
          changed = true;
          bus.emit("questProgress", {
            questId: instance.questId,
            objectiveIndex: i,
            current: next,
            target: obj.targetCount,
          });
        } else if (obj.kind === "state") {
          // Re-evaluate state objective on relevant events.
          const relevantEvents = deriveReevalEvents(obj.check);
          if (!relevantEvents.includes(eventType)) continue;
          const met = evaluateQuestCondition(obj.check, state) ? 1 : 0;
          if (instance.progress[i] !== met) {
            instance.progress[i] = met;
            changed = true;
            bus.emit("questProgress", {
              questId: instance.questId,
              objectiveIndex: i,
              current: met,
              target: 1,
            });
          }
        }
      }

      if (changed && allObjectivesMet(instance, def)) {
        transitionToReady(instance, def);
      }
    }

    // After processing active quests, check if any unavailable quest now meets
    // prerequisites (for autoAccept).
    checkAutoAccept(eventType);
  }

  function transitionToReady(instance: QuestInstance, def: QuestDef): void {
    const turnInMode = def.turnIn?.mode ?? "auto";
    if (turnInMode === "auto") {
      // Skip "ready" state — immediately complete.
      doTurnIn(instance, def);
    } else {
      instance.status = "ready";
      bus.emit("questReady", { questId: instance.questId });
    }
  }

  function doTurnIn(instance: QuestInstance, def: QuestDef): void {
    const state = getState();
    const target = resolveTarget(instance, state);

    // Apply turn-in cost if configured.
    if (def.turnIn?.cost) {
      const costCtx: CostCheckContext = {
        state,
        inventoryId: target.id,
      };
      applyCost(def.turnIn.cost, costCtx);
    }

    // Grant rewards.
    if (def.rewards && target) {
      const rewardCtx: GrantRewardsContext = {
        state,
        bus,
        rng,
        currentTick: currentTick(),
        source: { kind: "other", id: instance.questId },
      };
      grantRewards(def.rewards, target, rewardCtx);
    }

    // Mark completed.
    instance.status = "completed";
    instance.completedAtTick = currentTick();
    instance.completionCount = (instance.completionCount ?? 0) + 1;
    bus.emit("questCompleted", { questId: instance.questId });

    // Execute onComplete actions.
    if (def.onComplete) {
      for (const action of def.onComplete) {
        executeAction(action);
      }
    }
  }

  /** Check autoAccept for quests whose prerequisites might now be met. */
  function checkAutoAccept(triggerEvent?: keyof GameEvents): void {
    for (const def of Object.values(content.quests)) {
      if (!def.autoAccept) continue;
      if (def.hidden) continue; // hidden + autoAccept is allowed but must be triggered explicitly
      if (!isEligible(def)) continue;
      // Only check if this event could affect the prerequisites.
      if (triggerEvent && def.prerequisites?.length) {
        const relevantEvents = new Set<keyof GameEvents>();
        for (const cond of def.prerequisites) {
          for (const e of deriveReevalEvents(cond)) relevantEvents.add(e);
        }
        if (!relevantEvents.has(triggerEvent)) continue;
      }
      if (!prerequisitesMet(def)) continue;
      accept(def.id);
    }
  }

  // ---------- Public methods ----------

  function accept(questId: string, charId?: string): void {
    const def = getQuestDef(questId);
    const state = getState();

    // If already active/ready, no-op.
    const existing = state.quests[questId];
    if (existing && (existing.status === "active" || existing.status === "ready")) return;

    // If repeatable and completed, reset progress.
    const instance: QuestInstance = {
      questId,
      status: "active",
      progress: def.objectives.map(() => 0),
      acceptedAtTick: currentTick(),
      completionCount: existing?.completionCount ?? 0,
      ...(def.scope === "character" ? { assignedCharId: charId ?? state.focusedCharId } : {}),
    };

    state.quests[questId] = instance;
    bus.emit("questAccepted", { questId, charId: instance.assignedCharId });

    // Immediately evaluate state-type objectives (they may already be met).
    let changed = false;
    for (let i = 0; i < def.objectives.length; i++) {
      const obj = def.objectives[i]!;
      if (obj.kind === "state") {
        const met = evaluateQuestCondition(obj.check, state) ? 1 : 0;
        if (met) {
          instance.progress[i] = met;
          changed = true;
        }
      }
    }
    if (changed && allObjectivesMet(instance, def)) {
      transitionToReady(instance, def);
    }
  }

  function abandon(questId: string): void {
    const state = getState();
    const instance = state.quests[questId];
    if (!instance) return;
    if (instance.status !== "active" && instance.status !== "ready") return;

    // Preserve completionCount for repeatable quests.
    const completionCount = instance.completionCount;
    delete state.quests[questId];
    // If there was a prior completion count, store a minimal record.
    if (completionCount && completionCount > 0) {
      // We don't persist "abandoned" as a status; we just delete the instance.
      // The quest becomes available again if prerequisites still hold.
    }
    bus.emit("questAbandoned", { questId });
  }

  function turnIn(questId: string): void {
    const state = getState();
    const instance = state.quests[questId];
    if (!instance || instance.status !== "ready") {
      throw new Error(`quest.turnIn: quest "${questId}" is not in ready state`);
    }
    const def = getQuestDef(questId);

    // Validate cost before applying.
    if (def.turnIn?.cost) {
      const target = resolveTarget(instance, state);
      const costCtx: CostCheckContext = { state, inventoryId: target.id };
      if (!checkCost(def.turnIn.cost, costCtx)) {
        throw new Error(`quest.turnIn: cannot afford turn-in cost for "${questId}"`);
      }
    }

    doTurnIn(instance, def);
  }

  function forceComplete(questId: string): void {
    const state = getState();
    const def = getQuestDef(questId);

    // Ensure instance exists.
    if (!state.quests[questId]) {
      accept(questId);
    }
    const instance = state.quests[questId]!;
    if (instance.status === "completed") return;

    // Fill all progress.
    for (let i = 0; i < def.objectives.length; i++) {
      const obj = def.objectives[i]!;
      instance.progress[i] = obj.kind === "event" ? obj.targetCount : 1;
    }

    // Force turnIn (skip cost check for debug).
    instance.status = "ready";
    doTurnIn(instance, def);
  }

  function getAvailableQuests(): string[] {
    const result: string[] = [];
    for (const def of Object.values(content.quests)) {
      if (def.hidden) continue;
      if (!isEligible(def)) continue;
      if (!prerequisitesMet(def)) continue;
      result.push(def.id);
    }
    return result;
  }

  function getActiveQuests(): QuestInstance[] {
    return Object.values(getState().quests).filter(
      (q) => q.status === "active" || q.status === "ready",
    );
  }

  function getInstance(questId: string): QuestInstance | undefined {
    return getState().quests[questId];
  }

  // ---------- Bus subscription ----------

  function attach(): () => void {
    // Collect all event types that any quest objective might care about,
    // plus prerequisite-trigger events for autoAccept. We use a broad strategy:
    // subscribe once per distinct eventType across all quests and filter internally.
    const allEventTypes = new Set<keyof GameEvents>();

    for (const def of Object.values(content.quests)) {
      for (const obj of def.objectives) {
        if (obj.kind === "event") {
          allEventTypes.add(obj.eventType);
        } else if (obj.kind === "state") {
          for (const e of deriveReevalEvents(obj.check)) allEventTypes.add(e);
        }
      }
      // Prerequisites (for autoAccept checks).
      if (def.prerequisites) {
        for (const cond of def.prerequisites) {
          for (const e of deriveReevalEvents(cond)) allEventTypes.add(e);
        }
      }
    }

    for (const eventType of allEventTypes) {
      const off = bus.on(eventType, (payload) => {
        onEvent(eventType, payload);
      });
      offs.push(off);
    }

    return () => {
      for (const off of offs) off();
      offs.length = 0;
    };
  }

  function reeval(): void {
    const state = getState();

    // Re-evaluate all state-type objectives on active quests.
    for (const instance of Object.values(state.quests)) {
      if (instance.status !== "active") continue;
      const def = content.quests[instance.questId];
      if (!def) continue;

      let changed = false;
      for (let i = 0; i < def.objectives.length; i++) {
        const obj = def.objectives[i]!;
        if (obj.kind !== "state") continue;
        const met = evaluateQuestCondition(obj.check, state) ? 1 : 0;
        if (instance.progress[i] !== met) {
          instance.progress[i] = met;
          changed = true;
        }
      }
      if (changed && allObjectivesMet(instance, def)) {
        transitionToReady(instance, def);
      }
    }

    // Check autoAccept for all eligible quests.
    for (const def of Object.values(content.quests)) {
      if (!def.autoAccept) continue;
      if (def.hidden) continue;
      if (!isEligible(def)) continue;
      if (!prerequisitesMet(def)) continue;
      accept(def.id);
    }
  }

  return {
    accept,
    abandon,
    turnIn,
    forceComplete,
    getAvailableQuests,
    getActiveQuests,
    getInstance,
    attach,
    reeval,
  };
}
