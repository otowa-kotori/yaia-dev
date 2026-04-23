// Deterministic seeded PRNG.
//
// All gameplay randomness MUST go through this. Do NOT use Math.random() in
// game-core code — it makes bugs non-reproducible and breaks save/load
// determinism.
//
// Algorithm: mulberry32. Fast, good enough for games, state fits in one uint32
// so it serializes trivially.

export interface Rng {
  /** Current internal state. Exposed for serialization. */
  state: number;
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Bool with given truth probability (default 0.5). */
  chance(p?: number): boolean;
  /** Pick a random element. Throws on empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Fork: produce an independent Rng derived from this one. */
  fork(): Rng;
}

/** Create an Rng from a 32-bit unsigned seed. */
export function createRng(seed: number): Rng {
  // Coerce to uint32. Seed 0 is fine for mulberry32 (produces a valid stream).
  let state = seed >>> 0;

  const obj: Rng = {
    get state(): number {
      return state;
    },
    set state(v: number) {
      state = v >>> 0;
    },
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      if (max < min) throw new Error(`rng.int: max (${max}) < min (${min})`);
      return min + Math.floor(obj.next() * (max - min + 1));
    },
    chance(p = 0.5) {
      return obj.next() < p;
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error("rng.pick: empty array");
      const v = arr[obj.int(0, arr.length - 1)];
      // Non-empty asserted above; narrow for noUncheckedIndexedAccess.
      return v as T;
    },
    fork(): Rng {
      // Derive a new independent stream by consuming one value and hashing it
      // into a new seed.
      const n = (obj.next() * 4294967296) >>> 0;
      return createRng(n);
    },
  };
  return obj;
}

/** Restore an Rng from a previously serialized state. */
export function restoreRng(state: number): Rng {
  return createRng(state);
}
