import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { EventBus } from "@vagus/host-events";
import type { CoreEventMap } from "@vagus/host-events";

/**
 * Extension UI bridge — ctx.ui dialogs (confirm/select/input), notify,
 * setStatus and setWidget, plus the durable ui-history store.
 *
 * Self-contained: owns all extension-UI state (pending dialogs, turn counters,
 * widget registry/lines cache) so VagusEngine doesn't accumulate per-feature
 * Maps. Writes answered dialogs to `<agentDir>/ui-history/<sessionId>.jsonl`
 * (NDJSON) so a daemon restart still restores read-only cards.
 */
export class ExtensionUiBridge {
  /**
   * Pending `ctx.ui` dialog requests (extension → web frontend). Keyed by a
   * UUID; resolveUi() completes the Promise so the extension continues.
   * Same pattern as pi's RPC `extension_ui_request`/`extension_ui_response`.
   */
  private readonly uiPending = new Map<string, { resolve: (result: Record<string, unknown>) => void; timer?: NodeJS.Timeout; request: Record<string, unknown> }>();

  /**
   * Task-level turn counter per session (agent_start = one turn). Cards
   * record their turn so the frontend can anchor them to the right work
   * block, not just the last one. After a daemon restart the counter is
   * re-based on the persisted ui-history (continuing a session keeps the
   * next card on the correct turn).
   */
  private readonly turnCounters = new Map<string, number>();

  /** Most recent tool call per session (tool_execution_start). The triggering
   *  tool's id is stamped onto each ctx.ui request so the frontend can anchor
   *  the card to that exact tool call (stable across reloads). */
  private readonly lastToolCallIds = new Map<string, string>();

  /**
   * Extension widgets (ctx.ui.setWidget) — shared by all sessions so
   * module-level widgets (rpiv-todo's TodoOverlay) whose `tui` points at one
   * mock still see every widget on requestRender.
   */
  private readonly widgetRegistry = new Map<string, { render: (w: number) => string[]; placement?: string; sessionId: string }>();

  /** Latest rendered widget lines (key → lines + owner session) — lets a
   *  freshly-connected web frontend re-hydrate widgets after a reload. */
  private readonly widgetLinesCache = new Map<string, { lines: string[]; placement: string; sessionId: string }>();

  constructor(
    private readonly bus: EventBus<CoreEventMap>,
    /** Provider for the agent dir (ui-history lives under it). */
    private readonly agentDir: () => string,
  ) {}

  /** Next turn number for a session. The base comes from the session's OWN
   *  history (user-message count = completed task turns), which is durable
   *  across daemon restarts and independent of ui-history (which may be
   *  cleared). ui-history max-turn is only a legacy fallback. */
  nextTurn(sessionId: string): number {
    const cur = this.turnCounters.get(sessionId);
    if (cur !== undefined) {
      const n = cur + 1;
      this.turnCounters.set(sessionId, n);
      return n;
    }
    let base = 0;
    try {
      const f = join(this.agentDir(), "ui-history", `${sessionId}.jsonl`);
      if (existsSync(f)) {
        for (const line of readFileSync(f, "utf8").split("\n")) {
          if (!line.trim()) continue;
          try {
            const t = (JSON.parse(line).request as { turn?: number })?.turn ?? 0;
            if (t > base) base = t;
          } catch {
            // skip corrupt line
          }
        }
      }
    } catch {
      // non-fatal
    }
    // By the time agent_start fires, the current user message is already
    // flushed to the session JSONL — so `base` already INCLUDES the current
    // turn. Turn = base (not base+1); a brand-new session (base 0) is turn 1.
    const n = base > 0 ? base : 1;
    this.turnCounters.set(sessionId, n);
    return n;
  }

  /** Remember the triggering tool call for a session (tool_execution_start). */
  noteToolCall(sessionId: string, toolCallId: string): void {
    this.lastToolCallIds.set(sessionId, toolCallId);
  }

  /**
   * Builds the ExtensionUIContext handed to extensions for a session. Each
   * dialog emits a `ui.request` bus event (forwarded to the GUI over
   * WebSocket); the frontend renders the dialog and calls `resolveUi()` via
   * the `ui.respond` RPC. Fire-and-forget methods (notify/…) are forwarded
   * as events with no pending promise.
   */
  createUiContext(sessionId: string): ExtensionUIContext {
    const request = <T>(
      method: "select" | "confirm" | "input",
      payload: Record<string, unknown>,
      opts: ExtensionUIDialogOptions | undefined,
      pick: (r: Record<string, unknown>) => T,
    ): Promise<T> => {
      const id = randomUUID();
      return new Promise<T>((resolve) => {
        const timer = opts?.timeout ? setTimeout(() => {
          this.uiPending.delete(id);
          resolve(pick({ cancelled: true }));
        }, opts.timeout) : undefined;
        this.uiPending.set(id, { resolve: (r) => { if (timer) clearTimeout(timer); resolve(pick(r)); }, timer, request: { type: "ui.request", id, method, timeout: opts?.timeout ?? null, ...payload, sessionId, turn: this.turnCounters.get(sessionId) ?? 0, toolCallId: this.lastToolCallIds.get(sessionId) } });
        void this.bus.emit("ui.request", {
          type: "ui.request", id, method, timeout: opts?.timeout ?? null, ...payload,
          sessionId, // tell the frontend which session this dialog belongs to
          turn: this.turnCounters.get(sessionId) ?? 0, // which task-turn this card belongs to
          toolCallId: this.lastToolCallIds.get(sessionId), // the triggering tool call (stable anchor)
        });
      });
    };
    // ── Widget support (aboveEditor / belowEditor fixed panels) ──
    // Registry + mock TUI live at BRIDGE level so all sessions share one;
    // module-level widgets (rpiv-todo's TodoOverlay) reference a single tui
    // mock whose requestRender must see every widget.
    const emitWidgetLines = (key: string, lines: string[], placement: string | undefined, sid: string) => {
      // Cache latest lines so a reloaded frontend can re-hydrate widgets.
      if (lines.length === 0) this.widgetLinesCache.delete(key);
      else this.widgetLinesCache.set(key, { lines, placement: placement ?? "aboveEditor", sessionId: sid });
      void this.bus.emit("ui.request", {
        type: "ui.request", id: randomUUID(), method: "widgetLines",
        widgetKey: key, lines, placement: placement ?? "aboveEditor",
        sessionId: sid, // tell the frontend which session this widget belongs to
      });
    };
    // Mock TUI — requestRender re-renders ALL registered widgets (each with
    // its own owning session).
    const widgetTui = { requestRender: () => {
      for (const [key, w] of this.widgetRegistry) {
        try { emitWidgetLines(key, w.render(80), w.placement, w.sessionId); } catch {}
      }
    }};

    return {
      select: (title, options, opts) =>
        request("select", { title, options }, opts, (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? String(r.value) : undefined)),
      confirm: (title, message, opts) =>
        request("confirm", { title, message }, opts, (r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed === true : false)),
      input: (title, placeholder, opts) =>
        request("input", { title, placeholder }, opts, (r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? String(r.value) : undefined)),
      notify: (message, type) => {
        void this.bus.emit("ui.request", {
          type: "ui.request", id: randomUUID(), method: "notify", message, notifyType: type ?? "info",
        });
      },
      setStatus: (key, text) => {
        // Persistent status text (shown above the input bar, like a status
        // strip). undefined clears the item for that key.
        void this.bus.emit("ui.request", {
          type: "ui.request", id: randomUUID(), method: "setStatus", statusKey: key, statusText: text ?? null,
        });
      },
      // ── TUI-only methods — no-op / degraded (same as pi's RPC mode) ──
      onTerminalInput: () => () => {},
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (content === undefined) {
          this.widgetRegistry.delete(key);
          emitWidgetLines(key, [], undefined, sessionId);
          return;
        }
        if (typeof content === "function") {
          // Factory form: mock tui + theme, call factory, get render, forward.
          try {
            const widget = content(widgetTui as never, {
              fg: (_c: string, t: string) => t,
              bg: (_c: string, t: string) => t,
              bold: (t: string) => t,
              italic: (t: string) => t,
              underline: (t: string) => t,
              inverse: (t: string) => t,
              strikethrough: (t: string) => t,
              getFgAnsi: () => "",
              getBgAnsi: () => "",
              getColorMode: () => "dark",
              getThinkingBorderColor: () => (t: string) => t,
              getBashModeBorderColor: () => (t: string) => t,
            } as never);
            this.widgetRegistry.set(key, { render: widget.render, placement: options?.placement, sessionId });
            const lines = widget.render(80);
            emitWidgetLines(key, lines, options?.placement, sessionId);
          } catch { /* factory/widget crashed — skip */ }
          return;
        }
        if (Array.isArray(content)) {
          // String array form: forward directly.
          this.widgetRegistry.delete(key);
          emitWidgetLines(key, content, options?.placement, sessionId);
          return;
        }
      },
      setFooter: () => {},
      setHeader: () => {},
      setEditorComponent: () => {},
      setEditorText: () => {},
      getEditorText: () => "",
      pasteToEditor: () => {},
      setToolsExpanded: () => {},
      getToolsExpanded: () => false,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "themes not supported in web mode" }),
      custom: () => Promise.resolve(undefined) as never,
      setTitle: () => {},
      editor: (_title, _prefill) => Promise.resolve<string | undefined>(undefined),
      addAutocompleteProvider: () => {},
      getEditorComponent: () => undefined,
      // Terminal theme mock — every coloring/styling method returns the text
      // as-is (no ANSI codes; the web frontend colors with CSS). This lets
      // extensions like permission-gate call theme.fg()/bold() safely.
      theme: {
        fg: (_color: string, text: string) => text,
        bg: (_color: string, text: string) => text,
        bold: (text: string) => text,
        italic: (text: string) => text,
        underline: (text: string) => text,
        inverse: (text: string) => text,
        strikethrough: (text: string) => text,
        getFgAnsi: () => "",
        getBgAnsi: () => "",
        getColorMode: () => "dark",
        getThinkingBorderColor: () => (t: string) => t,
        getBashModeBorderColor: () => (t: string) => t,
      } as never,
    };
  }

  /** Resolve a pending extension UI dialog (from the `ui.respond` RPC). */
  resolveUi(id: string, result: Record<string, unknown>): void {
    const pending = this.uiPending.get(id);
    if (pending) {
      this.uiPending.delete(id);
      // Persist the answered exchange to disk (~/.pi/agent/ui-history/…) so a
      // daemon RESTART (not just a page reload) still restores the read-only
      // cards in the conversation stream — durable, not a memory cache.
      const request = pending.request;
      try {
        const sid = String((request as { sessionId?: unknown }).sessionId ?? "global");
        const dir = join(this.agentDir(), "ui-history");
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, `${sid}.jsonl`), JSON.stringify({ request, result, ts: Date.now() }) + "\n", "utf8");
      } catch {
        // Non-fatal: the extension still resolves; only the history record is lost.
      }
      pending.resolve(result);
    }
  }

  /** Latest widget state (key → lines + owner session) for frontend re-hydration. */
  getWidgets(): Record<string, { lines: string[]; placement: string; sessionId: string }> {
    return Object.fromEntries(this.widgetLinesCache);
  }

  /** Pending extension dialogs (confirm/select/input) — still awaiting a
   *  response after a page reload. Answered ones live on disk (ui.history). */
  getPendingUiRequests(): Array<{ id: string; request: Record<string, unknown> }> {
    const out: Array<{ id: string; request: Record<string, unknown> }> = [];
    for (const [id, p] of this.uiPending) {
      out.push({ id, request: p.request });
    }
    return out;
  }

  /**
   * Answered extension dialogs, DURABLY persisted per session on disk
   * (`~/.pi/agent/ui-history/<sessionId>.jsonl`, NDJSON append). Survives
   * daemon restarts — the frontend restores read-only cards from here.
   */
  getUiHistory(): Record<string, Array<{ request: Record<string, unknown>; result: Record<string, unknown> }>> {
    const out: Record<string, Array<{ request: Record<string, unknown>; result: Record<string, unknown> }>> = {};
    try {
      const dir = join(this.agentDir(), "ui-history");
      if (!existsSync(dir)) return out;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        const sid = f.slice(0, -".jsonl".length);
        const records: Array<{ request: Record<string, unknown>; result: Record<string, unknown> }> = [];
        for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
          if (line.trim().length > 0) {
            try {
              const parsed = JSON.parse(line) as { request: Record<string, unknown>; result: Record<string, unknown> };
              if (parsed.request && parsed.result) records.push(parsed);
            } catch {
              // Skip corrupt lines defensively.
            }
          }
        }
        if (records.length > 0) out[sid] = records;
      }
    } catch {
      // Non-fatal — history is best-effort.
    }
    return out;
  }
}
