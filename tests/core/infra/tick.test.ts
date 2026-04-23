import { describe, test, expect } from "bun:test";
import { createTickEngine, runForTicks, type Tickable } from "../../../src/core/infra/tick";

function counterTickable(id = "c"): Tickable & { count: number } {
  return {
    id,
    count: 0,
    tick() {
      this.count += 1;
    },
  };
}

describe("tick", () => {
  test("step advances currentTick and ticks registered tickables", () => {
    const engine = createTickEngine();
    const a = counterTickable("a");
    engine.register(a);
    engine.step(5);
    expect(engine.currentTick).toBe(5);
    expect(a.count).toBe(5);
  });

  test("step(0) is a no-op", () => {
    const engine = createTickEngine();
    const a = counterTickable();
    engine.register(a);
    engine.step(0);
    expect(engine.currentTick).toBe(0);
    expect(a.count).toBe(0);
  });

  test("step rejects invalid n", () => {
    const engine = createTickEngine();
    expect(() => engine.step(-1)).toThrow();
    expect(() => engine.step(1.5)).toThrow();
  });

  test("unregister stops receiving ticks", () => {
    const engine = createTickEngine();
    const a = counterTickable("a");
    const off = engine.register(a);
    engine.step(3);
    off();
    engine.step(5);
    expect(a.count).toBe(3);
    expect(engine.currentTick).toBe(8);
  });

  test("duplicate register throws", () => {
    const engine = createTickEngine();
    engine.register(counterTickable("dup"));
    expect(() => engine.register(counterTickable("dup"))).toThrow();
  });

  test("auto-prunes tickable when isDone returns true", () => {
    const engine = createTickEngine();
    let done = false;
    const t: Tickable = {
      id: "once",
      tick: () => {
        done = true;
      },
      isDone: () => done,
    };
    engine.register(t);
    expect(engine.listTickables().length).toBe(1);
    engine.step(1);
    expect(engine.listTickables().length).toBe(0);
  });

  test("register/unregister during tick is tolerated", () => {
    const engine = createTickEngine();
    const spawned = counterTickable("spawned");
    const parent: Tickable = {
      id: "parent",
      tick() {
        if (engine.listTickables().find((x) => x.id === "spawned")) return;
        engine.register(spawned);
      },
    };
    engine.register(parent);
    engine.step(1); // parent spawns child
    engine.step(1); // child ticks
    expect(spawned.count).toBeGreaterThanOrEqual(1);
  });

  test("setTick restores clock (for load-game)", () => {
    const engine = createTickEngine();
    engine.step(10);
    engine.setTick(999);
    expect(engine.currentTick).toBe(999);
  });

  test("setTick rejects invalid values", () => {
    const engine = createTickEngine();
    expect(() => engine.setTick(-1)).toThrow();
    expect(() => engine.setTick(1.5)).toThrow();
  });

  test("speedMultiplier setter rejects invalid values", () => {
    const engine = createTickEngine();
    expect(() => (engine.speedMultiplier = -1)).toThrow();
    expect(() => (engine.speedMultiplier = Number.POSITIVE_INFINITY)).toThrow();
    engine.speedMultiplier = 0;
    expect(engine.speedMultiplier).toBe(0);
    engine.speedMultiplier = 5;
    expect(engine.speedMultiplier).toBe(5);
  });

  test("runForTicks wraps step(n)", () => {
    const engine = createTickEngine();
    const a = counterTickable();
    engine.register(a);
    runForTicks(engine, 12);
    expect(a.count).toBe(12);
  });

  test("start() uses injected setInterval and respects speedMultiplier", () => {
    let scheduled: (() => void) | null = null;
    const engine = createTickEngine({
      setInterval: (fn) => {
        scheduled = fn;
        return 1;
      },
      clearInterval: () => {
        scheduled = null;
      },
      initialSpeedMultiplier: 3,
    });
    const a = counterTickable();
    engine.register(a);
    const stop = engine.start();
    // Two physical ticks, each advancing speedMultiplier (3) logic ticks.
    scheduled!();
    scheduled!();
    expect(a.count).toBe(6);
    stop();
    expect(scheduled).toBe(null);
  });

  test("fractional speedMultiplier accumulates across physical ticks", () => {
    let scheduled: (() => void) | null = null;
    const engine = createTickEngine({
      setInterval: (fn) => {
        scheduled = fn;
        return 1;
      },
      clearInterval: () => {
        scheduled = null;
      },
      initialSpeedMultiplier: 0.5,
    });
    const a = counterTickable();
    engine.register(a);
    engine.start();
    scheduled!(); // 0.5 => 0 ticks
    expect(a.count).toBe(0);
    scheduled!(); // +0.5 => 1 tick
    expect(a.count).toBe(1);
  });

  test("tickables run in registration order within a step", () => {
    const engine = createTickEngine();
    const log: string[] = [];
    const make = (id: string): Tickable => ({
      id,
      tick: () => void log.push(id),
    });
    engine.register(make("a"));
    engine.register(make("b"));
    engine.register(make("c"));
    engine.step(1);
    expect(log).toEqual(["a", "b", "c"]);
  });

  test("re-registering after unregister moves tickable to the end", () => {
    const engine = createTickEngine();
    const log: string[] = [];
    const make = (id: string): Tickable => ({
      id,
      tick: () => void log.push(id),
    });
    engine.register(make("a"));
    engine.register(make("b"));
    engine.register(make("c"));
    engine.unregister("a");
    engine.register(make("a"));
    engine.step(1);
    expect(log).toEqual(["b", "c", "a"]);
  });

  test("tickable registered during a step does NOT run that step", () => {
    const engine = createTickEngine();
    const log: string[] = [];
    engine.register({
      id: "spawner",
      tick: () => {
        log.push("spawner");
        if (engine.listTickables().some((t) => t.id === "child")) return;
        engine.register({ id: "child", tick: () => void log.push("child") });
      },
    });
    engine.step(1);
    expect(log).toEqual(["spawner"]);
    engine.step(1);
    expect(log).toEqual(["spawner", "spawner", "child"]);
  });
});
