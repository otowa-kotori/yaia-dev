// Tiny synchronous event bus.
//
// Use for loose-coupled cross-cutting notifications (achievements, quests,
// UI hints). DO NOT drive core combat / activity flow through events — keep
// those as direct function calls so the simulator and tests remain trivial
// to reason about.

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

/** Canonical event map for the game. Extend as new systems come online. */
export type GameEvents = {
  levelup: { charId: string; level: number };
  kill: { attackerId: string; victimId: string };
  damage: { attackerId: string; targetId: string; amount: number };
  loot: { charId: string; itemId: string; qty: number };
  activityComplete: { charId: string | null; kind: string };
};

export type GameEventBus = EventBus<GameEvents>;

export function createGameEventBus(): GameEventBus {
  return new EventBus<GameEvents>();
}
