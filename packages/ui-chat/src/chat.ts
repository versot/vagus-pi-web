/**
 * Chat state for the GUI (M4a).
 *
 * The chat stream is a list of items rendered in order: user messages,
 * assistant replies (streaming), and inline execution blocks — tool calls
 * (Codex-style). This module owns the pure state transitions; the App
 * component renders the resulting items.
 *
 * Designed to be testable without React: feed it protocol events, assert on
 * the resulting items.
 */

import type { HistoryMessage } from "@vagus/ui-tokens";

export type ChatItem =
  | { id: number; kind: "user"; text: string; entryId?: string; skillTag?: string; images?: Array<{ dataUrl: string; mimeType: string }> }
  | { id: number; kind: "assistant"; text: string }
  | {
      id: number;
      kind: "thinking";
      text: string;
      collapsed?: boolean;
      /** Full-turn duration (question → turn end, incl. final answer). */
      turnDurationMs?: number;
    }
  | {
      id: number;
      kind: "tool";
      toolCallId: string;
      name: string;
      args: string;
      status: "running" | "succeeded" | "failed";
      result?: string;
      /** File-edit diff (pi display format) — renders a red/green diff. */
      diff?: string;
      /** Unified patch for the file edit — reverse-appliable to revert. */
      patch?: string;
      collapsed?: boolean;
      /** Full-turn duration (question → turn end, incl. final answer). */
      turnDurationMs?: number;
    }
  | { id: number; kind: "system"; text: string };

export type ChatAction =
  | { type: "userMessage"; id: number; text: string; skillTag?: string; images?: Array<{ dataUrl: string; mimeType: string }> }
  | { type: "userMessageEntryId"; id: number; entryId: string }
  | { type: "assistantDelta"; id: number; text: string }
  | {
      type: "toolCallStarted";
      id: number;
      toolCallId: string;
      name: string;
      args: string;
    }
  | { type: "toolCallFinished"; toolCallId: string; result: string; isError: boolean; diff?: string; patch?: string }
  | { type: "thinkingDelta"; id: number; text: string }
  | { type: "thinkingDone"; id: number }
  | { type: "collapseAll" }
  | { type: "toggleCollapse"; id: number }
  | { type: "setCollapse"; ids: number[]; collapsed: boolean }
  | { type: "turnEnd"; startedAt: number; endedAt: number }
  | { type: "system"; id: number; text: string }
  | { type: "removeMessage"; id: number }
  | { type: "clear" }
  | { type: "historyLoaded"; id: number; messages: HistoryMessage[] }
  | { type: "prependHistory"; id: number; messages: HistoryMessage[] };

export type ChatState = ChatItem[];

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "clear":
      return [];

    case "toolCallStarted":
      return [
        ...state,
        {
          id: action.id,
          kind: "tool",
          toolCallId: action.toolCallId,
          name: action.name,
          args: action.args,
          status: "running",
          collapsed: true,
        },
      ];

    case "toolCallFinished": {
      const updated = [...state];
      for (let i = updated.length - 1; i >= 0; i--) {
        const item = updated[i] as ChatItem | undefined;
        if (!item || item.kind !== "tool" || item.toolCallId !== action.toolCallId) continue;
        updated[i] = {
          ...item,
          status: action.isError ? "failed" : "succeeded",
          result: action.result,
          ...(action.diff !== undefined ? { diff: action.diff } : {}),
          ...(action.patch !== undefined ? { patch: action.patch } : {}),
          collapsed: true,
        };
        break;
      }
      return updated;
    }

    case "thinkingDelta": {
      // Merge into the last thinking card whether it was created live or
      // rebuilt collapsed from history — otherwise a delta that arrives after
      // a history rebuild (refresh racing the stream) spawns a duplicate card.
      const last = state[state.length - 1];
      if (last && last.kind === "thinking") {
        const updated = [...state];
        updated[updated.length - 1] = { ...last, text: `${last.text}${action.text}`, collapsed: false };
        return updated;
      }
      // First delta in a new thinking block — create a fresh card.
      return [...state, { id: action.id, kind: "thinking", text: action.text }];
    }

    case "thinkingDone":
      // No-op: thinking stays expanded while the turn is live (the work block
      // auto-collapses at turn end). Duration is tracked via `turnEnd`.
      return state;

    case "collapseAll": {
      return state.map((item) => {
        if (item.kind === "thinking" || item.kind === "tool") {
          return { ...item, collapsed: true };
        }
        return item;
      });
    }

    case "setCollapse": {
      const set = new Set(action.ids);
      return state.map((item) => {
        if (!set.has(item.id)) return item;
        if (item.kind !== "thinking" && item.kind !== "tool") return item;
        return { ...item, collapsed: action.collapsed };
      });
    }

    case "toggleCollapse": {
      return state.map((item) => {
        if (item.id !== action.id) return item;
        if (item.kind !== "thinking" && item.kind !== "tool") return item;
        return { ...item, collapsed: !item.collapsed };
      });
    }

    case "turnEnd": {
      // Record the full-turn duration (question → turn end, incl. the final
      // conclusion) on the last work item so the work block can show it.
      const updated = [...state];
      for (let i = updated.length - 1; i >= 0; i--) {
        const item = updated[i] as ChatItem | undefined;
        if (!item || (item.kind !== "thinking" && item.kind !== "tool")) continue;
        updated[i] = { ...item, turnDurationMs: Math.max(0, action.endedAt - action.startedAt) };
        break;
      }
      return updated;
    }

    case "historyLoaded":
      // Rebuild the conversation path into the same items the live stream
      // produced: user bubbles, assistant markdown, collapsed thinking cards,
      // and collapsed tool cards carrying their matched results — so a
      // reloaded session looks identical to the live conversation. The daemon
      // stamps each turn's total duration on its last message; we carry it
      // onto the turn's last work item so the work block shows the timing.
      {
        const rebuilt: ChatItem[] = [];
        let turnWorkLast: number | undefined; // rebuilt-index of this turn's last thinking/tool item
        for (let i = 0; i < action.messages.length; i++) {
          const message = action.messages[i]!;
          const base = action.id + 1 + i * 10;
          const items: ChatItem[] = [];

          if (message.role === "user" && !message.toolCalls) {
            turnWorkLast = undefined; // a new turn begins
            items.push({ id: base + 100, kind: "user", text: message.text, ...(message.images && message.images.length > 0 ? { images: message.images } : {}) });
          }
          if (message.thinking) {
            items.push({ id: base, kind: "thinking", text: message.thinking, collapsed: true });
            turnWorkLast = rebuilt.length + items.length - 1;
          }
          if (message.toolCalls) {
            for (let c = 0; c < message.toolCalls.length; c++) {
              const call = message.toolCalls[c]!;
              items.push({
                id: base + 1 + c,
                kind: "tool",
                toolCallId: call.id || `hist-${i}-${c}`,
                name: call.name,
                args: call.args,
                status: call.isError === true ? "failed" : "succeeded",
                result: call.result,
                ...(call.diff !== undefined ? { diff: call.diff } : {}),
                ...(call.patch !== undefined ? { patch: call.patch } : {}),
                collapsed: true,
              });
              turnWorkLast = rebuilt.length + items.length - 1;
            }
          }
          if (message.role === "assistant") {
            items.push({ id: base + 100, kind: "assistant", text: message.text });
          }
          if (message.role === "system") {
            // Compaction/branch-summary notes and engine notices.
            items.push({ id: base + 100, kind: "system", text: message.text });
          }

          rebuilt.push(...items);
          if (message.turnDurationMs !== undefined && turnWorkLast !== undefined) {
            const target = rebuilt[turnWorkLast];
            if (target && (target.kind === "thinking" || target.kind === "tool")) {
              rebuilt[turnWorkLast] = { ...target, turnDurationMs: message.turnDurationMs };
            }
          }
        }
        return rebuilt;
      }
    case "prependHistory": {
      // Lazy-loaded EARLIER messages — insert at the head of the existing
      // timeline. ids run NEGATIVE (action.id + 1 + i*10 negated) so they can
      // never collide with the positive ids used by historyLoaded/live stream.
      const earlier: ChatItem[] = [];
      let turnWorkLast: number | undefined;
      for (let i = 0; i < action.messages.length; i++) {
        const message = action.messages[i]!;
        const base = -(action.id + 1 + i * 10);
        const items: ChatItem[] = [];

        if (message.role === "user" && !message.toolCalls) {
          turnWorkLast = undefined;
          items.push({ id: base + 100, kind: "user", text: message.text, ...(message.images && message.images.length > 0 ? { images: message.images } : {}) });
        }
        if (message.thinking) {
          items.push({ id: base, kind: "thinking", text: message.thinking, collapsed: true });
          turnWorkLast = earlier.length + items.length - 1;
        }
        if (message.toolCalls) {
          for (let c = 0; c < message.toolCalls.length; c++) {
            const call = message.toolCalls[c]!;
            items.push({
              id: base + 1 + c,
              kind: "tool",
              toolCallId: call.id || `hist-${i}-${c}`,
              name: call.name,
              args: call.args,
              status: call.isError === true ? "failed" : "succeeded",
              result: call.result,
              ...(call.diff !== undefined ? { diff: call.diff } : {}),
              ...(call.patch !== undefined ? { patch: call.patch } : {}),
              collapsed: true,
            });
            turnWorkLast = earlier.length + items.length - 1;
          }
        }
        if (message.role === "assistant") {
          items.push({ id: base + 100, kind: "assistant", text: message.text });
        }
        if (message.role === "system") {
          items.push({ id: base + 100, kind: "system", text: message.text });
        }

        earlier.push(...items);
        if (message.turnDurationMs !== undefined && turnWorkLast !== undefined) {
          const target = earlier[turnWorkLast];
          if (target && (target.kind === "thinking" || target.kind === "tool")) {
            earlier[turnWorkLast] = { ...target, turnDurationMs: message.turnDurationMs };
          }
        }
      }
      return [...earlier, ...state];
    }
    case "userMessageEntryId": {
      return state.map((item) => {
        if (item.id !== action.id || item.kind !== "user") return item;
        return { ...item, entryId: action.entryId };
      });
    }

    case "userMessage":
      return [...state, { id: action.id, kind: "user", text: action.text, ...(action.skillTag ? { skillTag: action.skillTag } : {}), ...(action.images && action.images.length > 0 ? { images: action.images } : {}) }];

    case "assistantDelta": {
      const last = state[state.length - 1];
      if (last && last.kind === "assistant") {
        const updated = [...state];
        updated[updated.length - 1] = { ...last, text: `${last.text}${action.text}` };
        return updated;
      }
      return [...state, { id: action.id, kind: "assistant", text: action.text }];
    }

    case "system":
      return [...state, { id: action.id, kind: "system", text: action.text }];

    case "removeMessage":
      return state.filter((item) => item.id !== action.id);
  }
}