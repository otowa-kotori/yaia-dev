// React hook: subscribe to the GameStore with useSyncExternalStore.

import { useSyncExternalStore } from "react";
import type { GameStore } from "../store";

export function useStore(store: GameStore) {
  const revision = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getRevision(),
    () => store.getRevision(),
  );
  return { store, revision };
}
