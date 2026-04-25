// Persisted player-facing game log.
//
// Rules:
// - Player-visible only. Internal debug traces still live elsewhere (`Battle.log`).
// - Plain data only; entries must survive JSON round-trips unchanged.
// - Fixed-size tail buffer to keep saves bounded.

export const GAME_LOG_LIMIT = 500;

export const GAME_LOG_CATEGORIES = [
  "world",
  "activity",
  "battle",
  "reward",
  "inventory",
  "growth",
  "economy",
  "dungeon",
] as const;

export type GameLogCategory = (typeof GAME_LOG_CATEGORIES)[number];

export interface GameLogScope {
  charId?: string;
  locationId?: string;
  stageId?: string;
  battleId?: string;
  dungeonSessionId?: string;
}

export interface GameLogEntry {
  tick: number;
  category: GameLogCategory;
  text: string;
  scope: GameLogScope;
}

const GAME_LOG_CATEGORY_SET = new Set<string>(GAME_LOG_CATEGORIES);

export function appendGameLogEntries(
  target: { gameLog: GameLogEntry[] },
  entries: readonly GameLogEntry[],
): void {
  if (entries.length === 0) return;
  target.gameLog.push(...entries);
  if (target.gameLog.length > GAME_LOG_LIMIT) {
    target.gameLog.splice(0, target.gameLog.length - GAME_LOG_LIMIT);
  }
}

export function assertGameLogEntries(value: unknown): asserts value is GameLogEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("save: missing gameLog array");
  }
  for (let i = 0; i < value.length; i += 1) {
    assertGameLogEntry(value[i], i);
  }
}

function assertGameLogEntry(value: unknown, index: number): asserts value is GameLogEntry {
  if (!value || typeof value !== "object") {
    throw new Error(`save: gameLog[${index}] must be an object`);
  }

  const entry = value as Partial<GameLogEntry>;
  if (!Number.isInteger(entry.tick) || (entry.tick ?? 0) < 0) {
    throw new Error(`save: gameLog[${index}].tick must be a non-negative integer`);
  }
  if (typeof entry.text !== "string" || entry.text.length === 0) {
    throw new Error(`save: gameLog[${index}].text must be a non-empty string`);
  }
  if (
    typeof entry.category !== "string" ||
    !GAME_LOG_CATEGORY_SET.has(entry.category)
  ) {
    throw new Error(`save: gameLog[${index}].category is invalid`);
  }
  assertScope(entry.scope, index);
}

function assertScope(value: unknown, index: number): asserts value is GameLogScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`save: gameLog[${index}].scope must be an object`);
  }

  const scope = value as Record<string, unknown>;
  for (const key of [
    "charId",
    "locationId",
    "stageId",
    "battleId",
    "dungeonSessionId",
  ] as const) {
    const field = scope[key];
    if (field !== undefined && typeof field !== "string") {
      throw new Error(`save: gameLog[${index}].scope.${key} must be a string when present`);
    }
  }
}
