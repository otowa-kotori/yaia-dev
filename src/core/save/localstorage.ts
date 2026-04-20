// LocalStorage-backed SaveAdapter. Sync underneath, but wrapped in Promise
// so callers can swap in an async backend later without API churn.
//
// Gracefully handles environments without localStorage (Node tests) by
// falling back to an in-memory map. This keeps the "real" save path runnable
// under bun:test without mocking.

import type { SaveAdapter } from "./adapter";

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export class LocalStorageSaveAdapter implements SaveAdapter {
  private readonly fallback = new Map<string, string>();

  async save(key: string, data: string): Promise<void> {
    if (hasLocalStorage()) {
      localStorage.setItem(key, data);
    } else {
      this.fallback.set(key, data);
    }
  }

  async load(key: string): Promise<string | null> {
    if (hasLocalStorage()) {
      return localStorage.getItem(key);
    }
    return this.fallback.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    if (hasLocalStorage()) {
      localStorage.removeItem(key);
    } else {
      this.fallback.delete(key);
    }
  }
}

/** In-memory adapter for tests and for headless simulation. */
export class InMemorySaveAdapter implements SaveAdapter {
  private readonly store = new Map<string, string>();
  async save(key: string, data: string): Promise<void> {
    this.store.set(key, data);
  }
  async load(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}
