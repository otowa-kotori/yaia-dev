import type { GameState } from "../../infra/state/types";

const UNLOCK_FLAG_PREFIX = "unlock.";

export interface UnlockResult {
  changed: boolean;
  flagKey: string;
}

export function toUnlockFlagKey(unlockId: string): string {
  return `${UNLOCK_FLAG_PREFIX}${unlockId}`;
}

export function isUnlocked(state: GameState, unlockId: string): boolean {
  return (state.flags[toUnlockFlagKey(unlockId)] ?? 0) > 0;
}

export function listUnlocked(state: GameState): string[] {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(state.flags)) {
    if (!key.startsWith(UNLOCK_FLAG_PREFIX) || value <= 0) continue;
    ids.push(key.slice(UNLOCK_FLAG_PREFIX.length));
  }
  ids.sort();
  return ids;
}

export function unlock(state: GameState, unlockId: string): UnlockResult {
  const flagKey = toUnlockFlagKey(unlockId);
  if ((state.flags[flagKey] ?? 0) > 0) {
    return { changed: false, flagKey };
  }
  state.flags[flagKey] = 1;
  return { changed: true, flagKey };
}
