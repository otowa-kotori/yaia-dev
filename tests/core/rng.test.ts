import { describe, test, expect } from "bun:test";
import { createRng, restoreRng } from "../../src/core/rng";

describe("rng", () => {
  test("same seed produces same sequence", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test("different seeds produce different sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    let differs = false;
    for (let i = 0; i < 100 && !differs; i++) {
      if (a.next() !== b.next()) differs = true;
    }
    expect(differs).toBe(true);
  });

  test("next() returns values in [0, 1)", () => {
    const r = createRng(123);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int() is inclusive on both ends", () => {
    const r = createRng(7);
    const hits = new Set<number>();
    for (let i = 0; i < 5000; i++) hits.add(r.int(0, 3));
    expect(hits.has(0)).toBe(true);
    expect(hits.has(3)).toBe(true);
    expect(hits.size).toBe(4);
  });

  test("int throws when max < min", () => {
    const r = createRng(0);
    expect(() => r.int(5, 3)).toThrow();
  });

  test("pick throws on empty array", () => {
    const r = createRng(0);
    expect(() => r.pick([] as number[])).toThrow();
  });

  test("state round-trips via restoreRng", () => {
    const a = createRng(999);
    for (let i = 0; i < 50; i++) a.next(); // advance
    const snapshot = a.state;

    const b = restoreRng(snapshot);
    for (let i = 0; i < 100; i++) {
      expect(b.next()).toBe(a.next());
    }
  });

  test("fork produces an independent stream", () => {
    const parent = createRng(42);
    const child = parent.fork();
    // Consuming from child doesn't affect a parallel parent with same original seed.
    const parent2 = createRng(42);
    parent2.fork(); // mirror: advance parent2 by one next() too
    for (let i = 0; i < 20; i++) {
      expect(parent2.next()).toBe(parent.next());
    }
    // Child produces something.
    const childValues = new Set<number>();
    for (let i = 0; i < 100; i++) childValues.add(child.next());
    expect(childValues.size).toBeGreaterThan(50);
  });
});
