import { useRef } from "react";
import type { JsonRpcClient, DomainEvent } from "@vagus/ui-shared";
import type { UsageStatsUI } from "@vagus/ui-tokens";
import type { Dispatch } from "react";
import type { SessionStoreAction } from "@vagus/ui-hooks";
import type { Autoscroll } from "@vagus/ui-hooks";
import type { UiRequestEvent } from "@vagus/ui-panes";

export interface EventEffects {
  fetchSessionInfo: (c: JsonRpcClient, sid: string, opts?: { updateActivePath?: boolean }) => void;
  refreshHistory: (c: JsonRpcClient) => Promise<void>;
  setUsageStats: (s: UsageStatsUI | null) => void;
  /** Extension UI bridge: ctx.ui.confirm/select/input (dialog) + notify. */
  onUiRequest?: (event: UiRequestEvent) => void;
  /** FIFO of original /skill:… user inputs (frontend records them on send). */
  shiftSkillText?: () => string | undefined;
}

/**
 * Daemon event routing — the only place DomainEvents are translated into
 * store actions. Side effects (scrolling, RPC refreshes) fire only for the
 * visible session; every session's slot still gets its own updates.
 *
 * The handler is recreated every render (so its closure sees fresh state)
 * and swapped into the client's event ref before the next event arrives.
 *
 * Text-delta batching: high-frequency `text_delta` events (one per token) are
 * accumulated per rAF frame (~16ms) and dispatched as a single state update.
 * This drops React commit frequency from per-token to per-frame — roughly a
 * 10× reduction for fast models — without affecting visual smoothness.
 */
export function useDaemonEvents(params: {
  client: JsonRpcClient | null;
  registerOnEvent: (fn: (event: DomainEvent) => void) => void;
  dispatch: Dispatch<SessionStoreAction>;
  nextId: () => number;
  activeId: string | undefined;
  autoscroll: Autoscroll;
  /** One-shot flag — set when the user answers a card; the next streamed
   *  message consumes it and scrolls to bottom (auto-scroll scenario 1). */
  followAnswerRef?: React.MutableRefObject<boolean>;
  effects: EventEffects;
}): void {
  const { client, registerOnEvent, dispatch, nextId, activeId, autoscroll, followAnswerRef, effects } = params;

  /** Consume the one-shot “answered a card → follow the reply” flag. */
  const consumeFollow = (): void => {
    if (followAnswerRef?.current) {
      followAnswerRef.current = false;
      autoscroll.scrollToBottom(true);
    }
  };

  // ── text-delta batching ──────────────────────────────────────────────────
  const deltaBuf = useRef<{ sessionId: string; text: string; raf: number | null }>({
    sessionId: "",
    text: "",
    raf: null,
  });

  /** Flush accumulated text_delta into a single dispatch (called by rAF). */
  const flushDelta = (): void => {
    const buf = deltaBuf.current;
    if (!buf.text) return;
    const text = buf.text;
    const sessionId = buf.sessionId;
    buf.text = "";
    buf.raf = null;
    dispatch({
      type: "applyEvent",
      sessionId,
      id: nextId(),
      event: { type: "session.message", sessionId, kind: "text_delta", text },
    });
    consumeFollow();
    autoscroll.followStream();
  };

  /** Schedule a rAF flush if not already pending. */
  const scheduleFlush = (sessionId: string, delta: string): void => {
    const buf = deltaBuf.current;
    if (buf.sessionId !== sessionId) {
      // Session switch — flush any stale buffer first.
      if (buf.raf !== null) cancelAnimationFrame(buf.raf);
      buf.text = "";
      buf.sessionId = sessionId;
    }
    buf.text += delta;
    if (buf.raf === null) {
      buf.raf = requestAnimationFrame(flushDelta);
    }
  };

  /** Force-flush any pending delta (e.g. before a text_done or session.end). */
  const forceFlush = (): void => {
    const buf = deltaBuf.current;
    if (buf.raf !== null) {
      cancelAnimationFrame(buf.raf);
      buf.raf = null;
    }
    if (buf.text) flushDelta();
  };
  // ── end batching ─────────────────────────────────────────────────────────

  const handleEvent = (event: DomainEvent): void => {
    const c = client;
    if (!c) return;
    const isActive = activeId !== undefined && event.sessionId === activeId;

    switch (event.type) {
      case "session.created":
        // DO NOT auto-activate here. Every intentional open path (sidebar
        // click → openSession, first message → session.create, newSession,
        // last-session restore) already dispatches activate explicitly with
        // a seq guard. Auto-activating on this event re-activates sessions
        // that load IN THE BACKGROUND (an older click whose session.open RPC
        // is still resolving), making the sidebar highlight jump even though
        // the user last clicked something else. Keep the side effects so the
        // sidebar/usage stay fresh — but don't move the active-path highlight.
        effects.fetchSessionInfo(c, event.sessionId, { updateActivePath: false });
        void effects.refreshHistory(c);
        return;
      case "session.turn":
        // Flush any pending text delta before a turn-end (safety).
        if (event.kind === "end") forceFlush();
        dispatch({ type: "applyEvent", sessionId: event.sessionId, id: nextId(), event });
        if (isActive && event.kind === "end") {
          effects.fetchSessionInfo(c, event.sessionId);
          void effects.refreshHistory(c);
          void c
            .request("usage.stats", {})
            .then((result) => effects.setUsageStats(result as UsageStatsUI))
            .catch(() => {});
        }
        return;
      case "session.message":
        // A /skill:… user message comes back EXPANDED (full SKILL.md injected).
        // If we recorded the original input, swap it in so the bubble shows /
        // copies the raw command — and carry the skill name as a tag.
        if (event.kind === "user_queued" && /<skill\s+name="/.test(event.text)) {
          const skillName = /<skill\s+name="([^"]+)"/.exec(event.text)?.[1];
          const original = effects.shiftSkillText?.();
          dispatch({
            type: "userMessage",
            sessionId: event.sessionId,
            id: nextId(),
            text: original ?? event.text,
            ...(skillName ? { skillTag: skillName } : {}),
          });
        } else if (event.kind === "text_delta") {
          // Batch: accumulate into rAF-window instead of dispatching per token.
          scheduleFlush(event.sessionId, event.text);
        } else if (event.kind === "text_done") {
          // Finalise: flush any pending delta before marking done.
          forceFlush();
          dispatch({ type: "applyEvent", sessionId: event.sessionId, id: nextId(), event });
        } else {
          dispatch({ type: "applyEvent", sessionId: event.sessionId, id: nextId(), event });
        }
        if (isActive) {
          if (event.kind === "user_queued") autoscroll.scrollToBottom(false);
          else if (event.kind === "error") autoscroll.scrollToBottom(false);
        }
        return;
      case "session.thinking":
        dispatch({ type: "applyEvent", sessionId: event.sessionId, id: nextId(), event });
        if (isActive && event.kind === "delta") {
          consumeFollow();
          autoscroll.followStream();
        }
        return;
      case "session.tool_call":
      case "session.tool_result":
        dispatch({ type: "applyEvent", sessionId: event.sessionId, id: nextId(), event });
        // pi updates its footer usage/cost on every message_end (each LLM
        // response, i.e. each tool-call round). A tool_call event arrives right
        // after the assistant message with the tool call ended, so refresh the
        // usage/context ring here to mirror that cadence.
        if (isActive && event.type === "session.tool_call") {
          effects.fetchSessionInfo(c, event.sessionId);
        }
        return;
      case "session.queue_update":
        dispatch({ type: "applyEvent", sessionId: event.sessionId, id: nextId(), event });
        return;
      default:
        // Extension UI bridge events (ui.request) aren't in the typed
        // DomainEvent union — match by string and forward to the handler.
        if ((event as { type?: string }).type === "ui.request") {
          effects.onUiRequest?.(event as unknown as UiRequestEvent);
        }
        return;
    }
  };

  registerOnEvent(handleEvent);
}