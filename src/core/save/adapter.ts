// SaveAdapter: storage backend abstraction.
//
// Implementations can be sync (localStorage) or async (IndexedDB, remote).
// The interface is Promise-based so async backends work naturally and sync
// backends pay a near-zero cost of wrapping.
//
// Swap the adapter by passing a different one into the save pipeline; Store
// and core modules don't care which backend is in use.

export interface SaveAdapter {
  /** Write raw string data to a named slot. */
  save(key: string, data: string): Promise<void>;
  /** Read raw string data from a named slot. Returns null if absent. */
  load(key: string): Promise<string | null>;
  /** Remove a named slot. */
  remove(key: string): Promise<void>;
}
