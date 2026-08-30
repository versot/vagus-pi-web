import { describe, expect, it } from "vitest";
import { chatReducer } from "@vagus/ui-chat";
import type { ChatState } from "@vagus/ui-chat";

describe("chatReducer", () => {
  it("appends user messages, assistant deltas and system lines in order", () => {
    let state: ChatState = [];
    state = chatReducer(state, { type: "userMessage", id: 1, text: "你好" });
    state = chatReducer(state, { type: "assistantDelta", id: 2, text: "Hi" });
    state = chatReducer(state, { type: "assistantDelta", id: 3, text: " there!" });
    state = chatReducer(state, { type: "system", id: 4, text: "connected" });

    expect(state.map((i) => i.kind)).toEqual(["user", "assistant", "system"]);
    const assistant = state[1];
    expect(assistant && assistant.kind === "assistant" && assistant.text).toBe("Hi there!");
  });

  it("merges streaming deltas into the last assistant line", () => {
    let state: ChatState = [];
    state = chatReducer(state, { type: "assistantDelta", id: 1, text: "流式" });
    state = chatReducer(state, { type: "assistantDelta", id: 2, text: " 输出" });
    expect(state).toHaveLength(1);
    const last = state[0];
    expect(last && last.kind === "assistant" && last.text).toBe("流式 输出");
  });

  it("clear drops all state", () => {
    let state: ChatState = [{ id: 1, kind: "user", text: "x" }];
    state = chatReducer(state, { type: "clear" });
    expect(state).toEqual([]);
  });

  it("historyLoaded rebuilds the stream from a conversation path", () => {
    const state = chatReducer([], {
      type: "historyLoaded",
      id: 10,
      messages: [
        { role: "user", text: "问1" },
        {
          role: "assistant",
          text: "最终回答",
          thinking: "思考过程",
          toolCalls: [
            { id: "tc1", name: "bash", args: "ls", result: "file.txt", isError: false },
          ],
        },
      ],
    });

    // user → thinking(collapsed) → tool(collapsed) → assistant(markdown)
    expect(state.map((i) => i.kind)).toEqual(["user", "thinking", "tool", "assistant"]);
    expect(state[0]).toMatchObject({ kind: "user", text: "问1" });

    const think = state[1];
    if (!think || think.kind !== "thinking") return expect(think).toBeDefined();
    expect(think.collapsed).toBe(true);
    expect(think.text).toBe("思考过程");

    const tool = state[2];
    if (!tool || tool.kind !== "tool") return expect(tool).toBeDefined();
    expect(tool.collapsed).toBe(true);
    expect(tool.name).toBe("bash");
    expect(tool.args).toBe("ls");
    expect(tool.result).toBe("file.txt");
    expect(tool.status).toBe("succeeded");

    expect(state[3]).toMatchObject({ kind: "assistant", text: "最终回答" });
  });

  it("historyLoaded skips toolResult-only entries", () => {
    const state = chatReducer([], {
      type: "historyLoaded",
      id: 10,
      messages: [
        { role: "user", text: "问" },
        { role: "assistant", text: "答", toolCalls: [{ id: "t1", name: "bash", args: "echo" }] },
        { role: "toolResult", text: "输出" },
      ],
    });
    // toolResult-only entries are skipped (already matched into toolCalls)
    expect(state.length).toBe(3);
  });

  it("historyLoaded marks tool as failed on error", () => {
    const state = chatReducer([], {
      type: "historyLoaded",
      id: 10,
      messages: [
        { role: "assistant", text: "ok", toolCalls: [{ id: "t1", name: "bash", args: "bad", result: "not found", isError: true }] },
      ],
    });
    const tool = state.find((i) => i.kind === "tool");
    if (!tool || tool.kind !== "tool") return expect(tool).toBeDefined();
    expect(tool.status).toBe("failed");
  });

  it("tracks a tool call through started → finished", () => {
    let state: ChatState = [];

    state = chatReducer(state, { type: "toolCallStarted", id: 1, toolCallId: "tc1", name: "bash", args: "ls -la" });
    expect(state[0]).toMatchObject({ kind: "tool", name: "bash", status: "running" });

    state = chatReducer(state, { type: "toolCallFinished", toolCallId: "tc1", result: "file.txt", isError: false });
    const done = state[0];
    if (!done || done.kind !== "tool") return expect(done).toBeDefined();
    expect(done.status).toBe("succeeded");
    expect(done.result).toBe("file.txt");
  });

  it("marks a tool as failed on error", () => {
    let state: ChatState = [];
    state = chatReducer(state, { type: "toolCallStarted", id: 1, toolCallId: "tc2", name: "bash", args: "bad" });
    state = chatReducer(state, { type: "toolCallFinished", toolCallId: "tc2", result: "not found", isError: true });
    const done = state[0];
    if (!done || done.kind !== "tool") return expect(done).toBeDefined();
    expect(done.status).toBe("failed");
  });

  it("streams thinking into a card, kept expanded until collapseAll", () => {
    let state: ChatState = [];
    state = chatReducer(state, { type: "thinkingDelta", id: 1, text: "思考" });
    state = chatReducer(state, { type: "thinkingDelta", id: 2, text: " 中" });
    const mid = state[0];
    if (!mid || mid.kind !== "thinking") return expect(mid).toBeDefined();
    expect(mid.text).toBe("思考 中");
    // Thinking stays expanded while the turn is live.
    expect(mid.collapsed).not.toBe(true);

    // The work block collapses via collapseAll (not thinkingDone — that is
    // deliberately a no-op so live thinking stays visible).
    state = chatReducer(state, { type: "collapseAll" });
    const done = state[0];
    if (!done || done.kind !== "thinking") return expect(done).toBeDefined();
    expect(done.collapsed).toBe(true);
  });

  it("collapseAll folds thinking and tool cards but keeps messages", () => {
    let state: ChatState = [];
    state = chatReducer(state, { type: "thinkingDelta", id: 1, text: "想" });
    state = chatReducer(state, { type: "toolCallStarted", id: 2, toolCallId: "tc3", name: "bash", args: "ls" });
    state = chatReducer(state, { type: "assistantDelta", id: 3, text: "结果" });

    state = chatReducer(state, { type: "collapseAll" });
    expect(state[0]).toMatchObject({ kind: "thinking", collapsed: true });
    expect(state[1]).toMatchObject({ kind: "tool", collapsed: true });
    expect(state[2]).toMatchObject({ kind: "assistant" });
  });

  it("toggleCollapse flips a card's collapsed flag", () => {
    let state: ChatState = [];
    state = chatReducer(state, { type: "thinkingDelta", id: 1, text: "想" });
    // Collapse it first (collapseAll is the collapse path for work blocks).
    state = chatReducer(state, { type: "collapseAll" });
    const collapsed = state[0];
    if (!collapsed || collapsed.kind !== "thinking") return expect(collapsed).toBeDefined();
    expect(collapsed.collapsed).toBe(true);

    // Toggle reopens the card.
    state = chatReducer(state, { type: "toggleCollapse", id: 1 });
    const reopened = state[0];
    if (!reopened || reopened.kind !== "thinking") return expect(reopened).toBeDefined();
    expect(reopened.collapsed).toBe(false);
  });

  it("prependHistory inserts earlier messages at the head without id collisions", () => {
    // First load: the LATEST page (positive ids).
    let state: ChatState = chatReducer([], {
      type: "historyLoaded",
      id: 100,
      messages: [
        { role: "user", text: "问题B" },
        { role: "assistant", text: "回答B" },
      ],
    });

    // Lazy-load an EARLIER page — ids must be negative and land before the head.
    state = chatReducer(state, {
      type: "prependHistory",
      id: 200,
      messages: [
        { role: "user", text: "问题A" },
        { role: "assistant", text: "回答A" },
      ],
    });

    const texts = state.map((i) => (i.kind === "user" || i.kind === "assistant" ? i.text : ""));
    expect(texts).toEqual(["问题A", "回答A", "问题B", "回答B"]);
    // ids are distinct across the two pages (negative vs positive).
    const ids = state.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBeLessThan(0);
    expect(ids[2]).toBeGreaterThan(0);
  });
});
import { groupChatItems } from "@vagus/ui-chat";
import type { ChatItem } from "@vagus/ui-chat";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;
function turn(id: number, name: string, args: string, diff: string): ToolItem {
  return {
    id,
    kind: "tool",
    toolCallId: `t${id}`,
    name,
    args,
    status: "succeeded",
    diff,
    collapsed: true,
  };
}

describe("groupChatItems turn summaries", () => {

  it("emits a turnSummary per turn with aggregated files, not cumulative", () => {
    const items = [
      { id: 1, kind: "user" as const, text: "第一轮：加一行" },
      turn(2, "edit", JSON.stringify({ file_path: "a.py" }), "+1 lineA"),
      { id: 3, kind: "assistant" as const, text: "完成" },
      { id: 4, kind: "user" as const, text: "第二轮：再加一行" },
      turn(5, "edit", JSON.stringify({ file_path: "a.py" }), "+1 lineB"),
      { id: 6, kind: "assistant" as const, text: "完成2" },
    ];
    const groups = groupChatItems(items);
    const summaries = groups.filter((g) => g.kind === "turnSummary");
    // 两个回合各一个汇总
    expect(summaries).toHaveLength(2);
    const s1 = summaries[0]!;
    const s2 = summaries[1]!;
    if (s1.kind !== "turnSummary" || s2.kind !== "turnSummary") throw new Error("kind");
    // 第二轮只包含本轮 +1（不是累计 +2）
    expect(s1.files).toHaveLength(1);
    expect(s1.files[0]!.added).toBe(1);
    expect(s2.files).toHaveLength(1);
    expect(s2.files[0]!.added).toBe(1);
    expect(s2.files[0]!.file).toBe("a.py");
    // diff 是拼接的显示 diff
    expect(s2.files[0]!.diff).toBe("+1 lineB");
  });

  it("aggregates multiple edits to the same file within one turn", () => {
    const items = [
      { id: 1, kind: "user" as const, text: "改两次" },
      turn(2, "edit", JSON.stringify({ file_path: "b.md" }), "+1 xx\n+2 yy"),
      turn(3, "edit", JSON.stringify({ file_path: "b.md" }), "-1 zz\n-2 ww"),
      { id: 4, kind: "assistant" as const, text: "ok" },
    ];
    const groups = groupChatItems(items);
    const summary = groups.find((g) => g.kind === "turnSummary");
    expect(summary).toBeDefined();
    if (!summary || summary.kind !== "turnSummary") throw new Error("kind");
    expect(summary.files).toHaveLength(1);
    expect(summary.files[0]!.added).toBe(2);
    expect(summary.files[0]!.removed).toBe(2);
    expect(summary.files[0]!.diff).toContain("+2 yy");
    expect(summary.files[0]!.diff).toContain("-1 zz");
  });
});
