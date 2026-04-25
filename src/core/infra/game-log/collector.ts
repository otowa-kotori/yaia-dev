import type { GameEventBus, GameEvents } from "../events";
import { appendGameLogEntries } from "./types";
import { gameLogRules, type GameLogRuleContext } from "./rules";
import type { GameState } from "../state/types";

type LoggedGameEventName = keyof typeof gameLogRules;

export interface AttachGameLogCollectorOptions {
  bus: GameEventBus;
  getState: () => GameState;
  getCurrentTick: () => number;
}

export function attachGameLogCollector(
  options: AttachGameLogCollectorOptions,
): () => void {
  const offs: Array<() => void> = [];

  for (const eventName of Object.keys(gameLogRules) as LoggedGameEventName[]) {
    const rule = gameLogRules[eventName];
    if (!rule) continue;

    const off = options.bus.on(eventName, (payload) => {
      const ctx: GameLogRuleContext = {
        state: options.getState(),
        currentTick: options.getCurrentTick(),
      };
      const result = rule(payload as never, ctx);
      const entries = normalizeEntries(result);
      if (entries.length === 0) return;

      appendGameLogEntries(options.getState(), entries);
      options.bus.emit("gameLogAppended", { entries });
    });

    offs.push(off);
  }

  return () => {
    for (const off of offs) off();
  };
}

function normalizeEntries(
  result:
    | ReturnType<(typeof gameLogRules)[LoggedGameEventName]>
    | null
    | undefined,
) {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}
