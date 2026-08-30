import { describe, expect, it } from "vitest";
import { emptySlot, sessionStoreReducer } from "../src/session-store.js";

describe("session store lazy-load pagination", () => {
  it("loadHistory stores hasMore / total / startIndex from session.open", () => {
    const next = sessionStoreReducer({ activeId: "p1", slots: {} }, {
      type: "loadHistory",
      sessionId: "p1",
      id: 1,
      messages: [{ role: "user", text: "最新问题" }],
      hasMore: true,
      total: 500,
      startIndex: 400,
    });

    const slot = next.slots["p1"]!;
    expect(slot.historyHasMore).toBe(true);
    expect(slot.historyTotal).toBe(500);
    expect(slot.historyStartIndex).toBe(400);
    expect(slot.items.length).toBe(1);
  });

  it("prependHistory prepends messages and advances the start index", () => {
    const initial = sessionStoreReducer({ activeId: "p1", slots: { "p1": { ...emptySlot(), historyHasMore: true, historyTotal: 500, historyStartIndex: 400 } } }, {
      type: "loadHistory",
      sessionId: "p1",
      id: 1,
      messages: [{ role: "user", text: "最新问题" }],
      hasMore: true,
      total: 500,
      startIndex: 400,
    });

    const next = sessionStoreReducer(initial, {
      type: "prependHistory",
      sessionId: "p1",
      id: 2,
      messages: [{ role: "user", text: "更早问题" }],
      hasMore: true,
      total: 500,
      startIndex: 300,
    });

    const slot = next.slots["p1"]!;
    // Head holds the older message, tail the newer one.
    const texts = slot.items.map((i) => (i.kind === "user" ? i.text : ""));
    expect(texts).toEqual(["更早问题", "最新问题"]);
    expect(slot.historyStartIndex).toBe(300);
    expect(slot.historyHasMore).toBe(true);
  });

  it("defaults hasMore=false and startIndex to the tail when open returns no meta", () => {
    const next = sessionStoreReducer({ activeId: "p1", slots: {} }, {
      type: "loadHistory",
      sessionId: "p1",
      id: 1,
      messages: [{ role: "user", text: "x" }],
    });
    const slot = next.slots["p1"]!;
    expect(slot.historyHasMore).toBe(false);
    expect(slot.historyTotal).toBe(1);
    expect(slot.historyStartIndex).toBe(0);
  });
});
