import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../src/event-bus.js";

interface TestEvents {
  "a.tick": { n: number };
  "a.done": { ok: boolean };
  "b.tick": { n: number };
}

const events = (): EventBus<TestEvents> => new EventBus<TestEvents>();

describe("EventBus", () => {
  it("delivers events to subscribers", () => {
    const bus = events();
    const listener = vi.fn();
    bus.subscribe("a.tick", listener);

    void bus.emit("a.tick", { n: 1 });
    expect(listener).toHaveBeenCalledWith({ n: 1 });
  });

  it("does not deliver to subscribers of other event names", () => {
    const bus = events();
    const listener = vi.fn();
    bus.subscribe("a.tick", listener);

    void bus.emit("b.tick", { n: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops delivery", () => {
    const bus = events();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe("a.tick", listener);
    unsubscribe();

    void bus.emit("a.tick", { n: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("once fires exactly once", async () => {
    const bus = events();
    const listener = vi.fn();
    bus.once("a.tick", listener);

    await bus.emit("a.tick", { n: 1 });
    await bus.emit("a.tick", { n: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("awaits async listeners", async () => {
    const bus = events();
    const order: string[] = [];
    bus.subscribe("a.tick", async () => {
      await Promise.resolve();
      order.push("first");
    });
    bus.subscribe("a.tick", () => {
      order.push("second");
    });

    await bus.emit("a.tick", { n: 1 });
    expect(order).toEqual(["first", "second"]);
  });

  it("isolates a throwing listener from the others", async () => {
    const bus = events();
    const onError = vi.fn();
    bus.onError(onError);
    const healthy = vi.fn();
    bus.subscribe("a.tick", () => {
      throw new Error("boom");
    });
    bus.subscribe("a.tick", healthy);

    await bus.emit("a.tick", { n: 1 });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "a.tick");
    expect(healthy).toHaveBeenCalled();
  });

  it("tracks listener counts and clears", () => {
    const bus = events();
    expect(bus.listenerCount("a.tick")).toBe(0);

    const unsubscribe = bus.subscribe("a.tick", () => {});
    expect(bus.listenerCount("a.tick")).toBe(1);

    unsubscribe();
    expect(bus.listenerCount("a.tick")).toBe(0);

    bus.subscribe("a.tick", () => {});
    bus.subscribe("b.tick", () => {});
    bus.clear();
    expect(bus.listenerCount("a.tick")).toBe(0);
    expect(bus.listenerCount("b.tick")).toBe(0);
  });
});
