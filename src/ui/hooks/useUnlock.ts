import type { GameStore } from "../store";
import { useStore } from "./useStore";

export function useUnlock(store: GameStore, unlockId: string): boolean {
  useStore(store);
  return store.isUnlocked(unlockId);
}
