import { describe, test, expect } from "bun:test";
import { EventBus, createGameEventBus } from "../../src/core/events";

describe("events", () => {
  test("on/emit delivers payload to listener", () => {
    const bus = new EventBus<{ ping: { value: number } }>();
    const received: number[] = [];
    bus.on("ping", (p) => received.push(p.value));
    bus.emit("ping", { value: 1 });
    bus.emit("ping", { value: 2 });
    expect(received).toEqual([1, 2]);
  });

  test("returned disposer unsubscribes", () => {
    const bus = new EventBus<{ tick: { t: number } }>();
    const received: number[] = [];
    const off = bus.on("tick", (p) => received.push(p.t));
    bus.emit("tick", { t: 1 });
    off();
    bus.emit("tick", { t: 2 });
    expect(received).toEqual([1]);
  });

  test("multiple listeners all fire", () => {
    const bus = new EventBus<{ x: number }>();
    const a: number[] = [];
    const b: number[] = [];
    bus.on("x", (v) => a.push(v));
    bus.on("x", (v) => b.push(v));
    bus.emit("x", 42);
    expect(a).toEqual([42]);
    expect(b).toEqual([42]);
  });

  test("listener that unsubscribes mid-emit doesn't break iteration", () => {
    const bus = new EventBus<{ x: number }>();
    const a: number[] = [];
    const b: number[] = [];
    const offA = bus.on("x", (v) => {
      a.push(v);
      offA();
    });
    bus.on("x", (v) => b.push(v));
    bus.emit("x", 1);
    bus.emit("x", 2);
    expect(a).toEqual([1]);
    expect(b).toEqual([1, 2]);
  });

  test("clear removes all listeners", () => {
    const bus = new EventBus<{ x: number }>();
    const received: number[] = [];
    bus.on("x", (v) => received.push(v));
    bus.clear();
    bus.emit("x", 1);
    expect(received).toEqual([]);
  });

  test("emitting an event with no listeners is a no-op", () => {
    const bus = createGameEventBus();
    expect(() => bus.emit("kill", { attackerId: "a", victimId: "b" })).not.toThrow();
  });
});
