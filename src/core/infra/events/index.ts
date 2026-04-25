// Tiny synchronous event bus.
//
// Use for loose-coupled cross-cutting notifications (achievements, quests,
// UI hints). DO NOT drive core combat / activity flow through events — keep
// those as direct function calls so the simulator and tests remain trivial
// to reason about.

import type { GameLogEntry } from "../game-log";

export type Listener<P> = (payload: P) => void;

/**
 * A typed event bus.
 * `Events` is a map of eventType -> payloadShape.
 * Example: EventBus<{ kill: { monsterId: string }; levelup: { charId: string; level: number } }>
 */
export class EventBus<Events extends Record<string, unknown>> {
  private listeners: {
    [K in keyof Events]?: Set<Listener<Events[K]>>;
  } = {};

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners[type];
    if (!set) {
      set = new Set();
      this.listeners[type] = set;
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void {
    this.listeners[type]?.delete(listener);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners[type];
    if (!set) return;
    // Iterate a snapshot so listeners that unsubscribe during emit are safe.
    for (const l of [...set]) l(payload);
  }

  clear(): void {
    this.listeners = {};
  }
}

export type ActivityLogKind = "combat" | "gather" | "dungeon";
export type ActivityStopReason =
  | "player"
  | "left_location"
  | "switch_activity"
  | "system";
export type CurrencyChangeSource =
  | "upgrade_purchase"
  | "kill_reward"
  | "wave_reward"
  | "dungeon_reward"
  | "other";

/** Canonical event map for the game. Extend as new systems come online. */
export type GameEvents = {
  levelup:
    | { kind: "character"; charId: string; level: number }
    | { kind: "skill"; charId: string; skillId: string; level: number };
  kill: { attackerId: string; victimId: string };
  damage: { attackerId: string; targetId: string; amount: number };
  heal: { sourceId: string; targetId: string; amount: number };
  loot: {
    charId: string;
    itemId: string;
    qty: number;
    stageId?: string;
    dungeonSessionId?: string;
  };
  /** Fired when items overflow into or are picked up from a stage's pending loot. */
  pendingLootChanged: { charId: string; stageId: string };
  pendingLootOverflowed: { charId: string; stageId: string; itemId: string; qty: number };
  pendingLootPicked: { charId: string; stageId: string; itemId: string; qty: number };
  pendingLootLost: {
    charId: string;
    stageId: string;
    entries: Array<{ itemId: string; qty: number }>;
  };
  inventoryChanged: { charId: string; inventoryId: string };
  equipmentChanged: { charId: string; slot: string };
  equipmentUpdated: {
    charId: string;
    slot: string;
    itemId: string;
    action: "equip" | "unequip";
  };
  crafted: { charId: string; recipeId: string };
  locationEntered: { charId: string; locationId: string };
  locationLeft: { charId: string; locationId: string };
  activityStarted:
    | {
        charId: string;
        kind: "combat";
        locationId: string;
        stageId: string;
        combatZoneId: string;
      }
    | {
        charId: string;
        kind: "gather";
        locationId: string;
        stageId: string;
        resourceNodeId: string;
      }
    | {
        charId: string;
        kind: "dungeon";
        locationId: string;
        stageId: string;
        dungeonSessionId: string;
        dungeonId: string;
      };
  activityStopped: {
    charId: string;
    kind: ActivityLogKind;
    reason: ActivityStopReason;
    stageId?: string;
    dungeonSessionId?: string;
  };
  battleStarted: {
    battleId: string;
    stageId: string;
    locationId: string;
    participantIds: string[];
    partyCharIds: string[];
    combatZoneId: string;
    waveId: string;
    waveIndex: number;
    dungeonSessionId?: string;
    dungeonId?: string;
  };
  battleActionResolved: {
    battleId: string;
    actorId: string;
    targetIds: string[];
    abilityId: string;
    outcome: "action" | "skip";
    note?: string;
    stageId?: string;
    locationId?: string;
    dungeonSessionId?: string;
  };
  battleActorDied: {
    battleId: string;
    victimId: string;
    stageId?: string;
    locationId?: string;
    dungeonSessionId?: string;
  };
  battleEnded: {
    battleId: string;
    outcome: "players_won" | "enemies_won" | "draw";
    stageId?: string;
    locationId?: string;
    dungeonSessionId?: string;
  };
  currencyChanged: {
    currencyId: string;
    amount: number;
    total: number;
    source: CurrencyChangeSource;
    charId?: string;
    stageId?: string;
    dungeonSessionId?: string;
  };
  upgradePurchased: {
    upgradeId: string;
    level: number;
    costCurrency: string;
    cost: number;
  };
  talentAllocated: { charId: string; talentId: string; newLevel: number };
  waveResolved: {
    charId: string;
    locationId: string;
    stageId?: string;
    battleId?: string;
    combatZoneId: string;
    waveId: string;
    waveIndex: number;
    outcome: "players_won" | "enemies_won";
  };
  activityComplete: {
    charId: string | null;
    kind: string;
    stageId?: string;
    dungeonSessionId?: string;
  };
  /** A dungeon wave was cleared by the party. */
  dungeonWaveCleared: {
    dungeonSessionId: string;
    dungeonId: string;
    stageId?: string;
    waveIndex: number;
  };
  /** The dungeon run completed successfully (all waves cleared). */
  dungeonCompleted: {
    dungeonSessionId: string;
    dungeonId: string;
    stageId?: string;
  };
  /** The dungeon run failed (party wipe). */
  dungeonFailed: {
    dungeonSessionId: string;
    dungeonId: string;
    stageId?: string;
    waveIndex: number;
  };
  /** The dungeon run was abandoned by the player. */
  dungeonAbandoned: {
    dungeonSessionId: string;
    dungeonId: string;
    stageId?: string;
  };
  gameLogAppended: { entries: GameLogEntry[] };
  /** Emitted each slice during chunked catch-up, so UI can render a progress bar. */
  catchUpProgress: { done: number; total: number };
  /** Emitted once after catch-up completes (or is cancelled). */
  catchUpApplied: { elapsedMs: number; appliedTicks: number; wasCapped: boolean; cancelled?: boolean };
};

export type GameEventBus = EventBus<GameEvents>;

export function createGameEventBus(): GameEventBus {
  return new EventBus<GameEvents>();
}
