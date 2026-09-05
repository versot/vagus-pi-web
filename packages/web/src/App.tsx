import { useCallback, useEffect, lazy, useMemo, useRef, useState, Suspense } from "react";
import type { Transport } from "@vagus/ui-shared";
import type { JsonRpcClient } from "@vagus/ui-shared";
import { SessionSidebar } from "@vagus/ui-sidebar";
import { FolderPicker, CommandPicker } from "@vagus/ui-input";
import type { ProjectOption, CommandInfo } from "@vagus/ui-input";
import type { Category } from "@vagus/ui-settings";
import { useAppearance, useTokens } from "@vagus/ui-tokens";
import type { SessionHistoryItem, SessionOpenResult, SessionPageResult, UsageStatsUI } from "@vagus/ui-tokens";
import { useVagusClient } from "@vagus/ui-hooks";
import { useSessionStore, WELCOME_SLOT } from "@vagus/ui-hooks";
import type { SessionInfo } from "@vagus/ui-hooks";
import { useArchiving } from "./useArchiving.js";
import { useRightPanel } from "./use-right-panel.js";
import { useDaemonEvents } from "./useDaemonEvents.js";
import { useModels } from "./useModels.js";
import { useAutoscroll } from "@vagus/ui-hooks";
import { useChatInput } from "@vagus/ui-hooks";
import { ChatPane } from "@vagus/ui-panes";
import { RightPanel, DiffTabContent, RevertReportModal } from "@vagus/ui-panes";
import { WIDGET_TAB, WidgetPanelContent } from "@vagus/ui-panes";
import type { RevertReport } from "@vagus/ui-panes";
import { WelcomePane } from "@vagus/ui-panes";
import { ConfirmDialog } from "@vagus/ui-panes";
import type { ConfirmState } from "@vagus/ui-panes";
import type { UiRequestEvent } from "@vagus/ui-panes";
import type { UiCardItem } from "@vagus/ui-panes";

// Lazy: settings / plugins panels are heavy and rarely open at startup, so
// they load in a separate chunk only when first opened (Suspense fallback
// below). The chat surface itself stays on the critical path.
const SettingsView = lazy(() =>
  import("@vagus/ui-settings").then((m) => ({ default: m.SettingsView })),
);
const PluginsView = lazy(() =>
  import("@vagus/ui-settings").then((m) => ({ default: m.PluginsView })),
);

/**
 * App — the composition root.
 *
 * Owns the daemon connection, the multi-session store, sidebar/settings
 * state, and the three top-level views (settings / welcome / chat). Chat
 * content, busy state and queued rail live in per-session slots inside the
 * store, so switching sessions never clears or reloads anything.
 */
export interface AppProps {
  /** For tests — inject a transport instead of opening a WebSocket. */
  transport?: Transport;
}

const copyMessage = (text: string): void => {
  void navigator.clipboard.writeText(text).catch(() => {});
};

/** Normalise text for fuzzy matching: trim + collapse whitespace. */
const normText = (s: string): string => s.trim().replace(/\s+/g, " ");

/**
 * Web-native builtin slash commands — routed to engine RPCs in sendMessage.
 * pi's own builtin slash commands (model/fork/tree/login/...) are TUI-only
 * and session.prompt() will NOT dispatch them, so only commands the web GUI
 * can actually execute are listed here (the GUI has dedicated UI for the
 * rest: model picker, session tree, settings panel, …).
 */
const WEB_BUILTIN_COMMANDS: CommandInfo[] = [
  { type: "builtin", name: "compact", description: "压缩上下文，摘要历史对话，腾出上下文空间" },
  { type: "builtin", name: "reload", description: "重新加载扩展、技能、提示词（装包后让 agent 感知新能力）" },
];

export function App({ transport: injectedTransport }: AppProps): JSX.Element {
  const t = useTokens();
  const { client, registerOnEvent } = useVagusClient(injectedTransport);
  const { state, dispatch, active } = useSessionStore();
  const autoscroll = useAutoscroll(active.items.length, state.activeId);
  const inputState = useChatInput();

  const hasEdits = active.items.some((i) => i.kind === "tool" && i.diff !== undefined);
  const [revertReport, setRevertReport] = useState<RevertReport | null>(null);
  const {
    rightTabs, rightTabId, rightCollapsed, rightPanelWidth, diffSelection, reviewTurnId, reviewOpen,
    setRightTabs, setRightTabId, setRightCollapsed, setRightPanelWidth, setReviewOpen,
    openFileDiff, closeRightTab,
  } = useRightPanel({ activeId: state.activeId, hasEdits });

  /** Globally increasing id for chat items (keys + item identity). */
  const idRef = useRef(0);
  const nextId = (): number => ++idRef.current;
  /** Monotonic counter — only the LATEST openSession call may activate.
   *  Rapid sidebar clicks fire concurrent `session.open` RPCs; whichever
   *  resolves first must not clobber the user's final pick. */
  const openSessionSeq = useRef(0);
  /** In-flight `session.open` RPC count — loading only clears when ALL finish. */
  const openSessionLoadingRef = useRef(0);
  /** Debounce timer for sidebar session clicks — must persist across renders
   *  (an IIFE-owned timer gets recreated every render and defeats the
   *  debounce, so rapid clicks fire N RPCs and the pane flickers). */
  const openSessionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Sidebar click handler: debounce rapid clicks to the LAST pick. The
   *  seq is bumped at CLICK time (not when the debounced openSession runs) so
   *  an in-flight `session.open` from a previous click is immediately treated
   *  as stale — otherwise its late-arriving result would re-activate that
   *  session and the sidebar highlight would jump even though the user never
   *  clicked it last. */
  const onOpenSession = (path: string): void => {
    openSessionSeq.current++;
    const seq = openSessionSeq.current;
    if (openSessionTimer.current !== undefined) clearTimeout(openSessionTimer.current);
    openSessionTimer.current = setTimeout(() => {
      openSessionTimer.current = undefined;
      if (client) void openSession(client, path, seq);
    }, 80);
  };

  // ── global (non-session) UI state ──────────────────────────────────────
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [activePath, setActivePath] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [settingsCat, setSettingsCat] = useState<Category>("appearance");
  const [usageStats, setUsageStats] = useState<UsageStatsUI | null>(null);
  const [pinnedSessions, setPinnedSessions] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  /** Extension UI bridge dialog (ctx.ui.confirm/select/input). */
  /** Extension UI cards per session — rendered INLINE in the conversation
   *  stream (a message, not a modal), so parallel sessions each keep their own
   *  pending confirm/select/input without any overlay machinery. */
  const [uiCards, setUiCards] = useState<Record<string, UiCardItem[]>>({});
  /** Cards belonging to the CURRENT session (incl. global/legacy ones). */
  const activeCards = uiCards[state.activeId ?? ""] ?? uiCards.global ?? [];
  /** Extension UI toast (ctx.ui.notify). */
  const [uiToast, setUiToast] = useState<{ text: string; type: "info" | "warning" | "error" } | null>(null);
  const uiToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Extension status texts (ctx.ui.setStatus) — key → text, shown above the input bar. */
  const [uiStatuses, setUiStatuses] = useState<Record<string, string>>({});
  /** Extension widgets (ctx.ui.setWidget) — key → rendered text lines + placement + session. */
  const [uiWidgets, setUiWidgets] = useState<Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor"; sessionId?: string }>>({});
  /** FIFO of original /skill:… inputs, so the echoed (expanded) user message
   *  can be swapped back to the raw command for display/copy. */
  const pendingSkillTexts = useRef<string[]>([]);
  // Extension UI state (widgets/status/toast) is driven by the extensions
  // themselves (setWidget(key, undefined) / setStatus(key, undefined) remove
  // them). rpiv-todo keeps its todo data at MODULE level (shared across
  // sessions), so switching sessions must NOT clear the widgets — they only
  // disappear when the extension removes them or the session is gone.
  // Sync the right-panel widget tab with active widgets (open when any widget
  // exists for the current session, remove when all are gone).
  const activeWidgets = useMemo(() => {
    const out: Record<string, { lines: string[] }> = {};
    for (const [key, w] of Object.entries(uiWidgets)) {
      if (w.lines.length > 0 && (!w.sessionId || w.sessionId === state.activeId)) {
        out[key] = { lines: w.lines };
      }
    }
    return out;
  }, [uiWidgets, state.activeId]);
  // Extension widgets that render ABOVE the input bar (placement="aboveEditor")
  // for the active session only.
  const aboveEditorWidgets = useMemo(() => {
    const out: Record<string, { lines: string[] }> = {};
    for (const [key, w] of Object.entries(uiWidgets)) {
      if (w.placement !== "aboveEditor") continue;
      if (w.lines.length > 0 && (!w.sessionId || w.sessionId === state.activeId)) {
        out[key] = { lines: w.lines };
      }
    }
    return out;
  }, [uiWidgets, state.activeId]);
  useEffect(() => {
    const hasWidgets = Object.keys(activeWidgets).length > 0;
    if (hasWidgets) {
      setRightTabs((prev) => (prev.some((tab) => tab.id === "widget") ? prev : [...prev, WIDGET_TAB]));
      setRightTabId((prev) => prev ?? "widget");
    } else {
      setRightTabs((prev) => (prev.some((tab) => tab.id === "widget") ? prev.filter((tab) => tab.id !== "widget") : prev));
      setRightTabId((prev) => (prev === "widget" ? undefined : prev));
    }
  }, [activeWidgets]); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeProject, setActiveProject] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Slash-command palette (builtin + extension + skill + template) for the "/" dropdown. */
  const [commands, setCommands] = useState<CommandInfo[]>(WEB_BUILTIN_COMMANDS);
  /** Increment to focus the input bar (session switch / returning from settings). */
  const [focusSignal, setFocusSignal] = useState(0);
  // Returning from the settings / plugins full-screen panel → focus the input.
  const wasPanelOpen = useRef(false);
  useEffect(() => {
    if (settingsOpen || pluginsOpen) { wasPanelOpen.current = true; return; }
    if (wasPanelOpen.current) { wasPanelOpen.current = false; setFocusSignal((n) => n + 1); }
  }, [settingsOpen, pluginsOpen]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState<"ask" | "auto">("ask");
  const [pendingModel, setPendingModel] = useState<{ providerId: string; modelId: string } | undefined>(undefined);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  /** Post-compaction context token estimate, shown until pi returns a real value. */
  const [contextOverride, setContextOverride] = useState<number | null>(null);
  /** True while a manual compaction is in flight (blocks sending). */
  const [compacting, setCompacting] = useState(false);
  /** sessionId → sessionFile, to map busy state onto the sidebar list. */
  const sessionFileBySessionId = useRef<Map<string, string>>(new Map());
  /** localStorage key remembering the last active session (restored on reload). */
  const LAST_SESSION_KEY = "vagus.lastSession";
  /** Only restore the last session once per app load. */
  const restoreDone = useRef(false);

  // Model config + archiving — self-contained domain hooks.
  const models = useModels(client);
  const confirm = useCallback((title: string, message: string, confirmLabel: string, onConfirm: () => void) => {
    setConfirmState({ title, message, confirmLabel, onConfirm });
  }, []);
  const { modelsConfig, enabledProviders } = models;

  // Auto-select the first available model on the welcome screen so the
  // user never lands without a model selected.
  useEffect(() => {
    if (!state.activeId && !pendingModel && enabledProviders.length > 0 && enabledProviders[0]!.models.length > 0) {
      const p = enabledProviders[0]!;
      setPendingModel({ providerId: p.id, modelId: p.models[0]!.id });
    }
  }, [state.activeId, pendingModel, enabledProviders]);

  // Fetch the session tree from the daemon (used by many actions below).
  const refreshHistory = useCallback(async (c: JsonRpcClient) => {
    try {
      const result = await c.request("session.history", {});
      if (Array.isArray(result)) {
        const items = result as SessionHistoryItem[];
        setSessions(items);
        // Rebuild sessionId → path map so pending-dialog dots show in the
        // sidebar right after a reload, without activating each session first.
        for (const it of items) {
          if (it.id && it.path) sessionFileBySessionId.current.set(it.id, it.path);
        }
      }
    } catch {
      // daemon may not support history yet — keep the sidebar empty
    }
  }, []);

  const archiving = useArchiving(
    client,
    refreshHistory,
    confirm,
    (path) => {
      // Active session removed (archived/deleted) — clear the view.
      if (activePath === path) {
        dispatch({ type: "activate", sessionId: undefined });
        setActivePath(undefined);
      }
    },
  );
  const { archivedProjects } = archiving;

  // Loading hint appears only after 300ms — fast switches stay invisible.
  useEffect(() => {
    if (!sessionLoading) {
      setShowLoading(false);
      return;
    }
    const id = window.setTimeout(() => setShowLoading(true), 300);
    return () => window.clearTimeout(id);
  }, [sessionLoading]);

  /** Fetch session info into its slot + record the sessionId → file mapping.
   *  `updateActivePath` (default true) also syncs the sidebar highlight.
   *  Background session.created events pass false — their sessionFile must
   *  NOT move the highlight (the user last clicked something else). */
  const fetchSessionInfo = (c: JsonRpcClient, sid: string, opts?: { updateActivePath?: boolean }): void => {
    void c
      .request("session.info", { sessionId: sid })
      .then((result) => {
        const info = result as SessionInfo & { sessionFile?: string };
        if (info?.sessionFile) {
          sessionFileBySessionId.current.set(sid, info.sessionFile);
          // Track the active session file so reloads restore the same chat.
          if (opts?.updateActivePath !== false) setActivePath(info.sessionFile);
        }
        // Once pi reports a real context occupancy, drop the post-compaction
        // override (it was only a placeholder until the next response).
        if (typeof info?.contextUsage?.tokens === "number") setContextOverride(null);
        dispatch({ type: "setInfo", sessionId: sid, info, thinkingLevel: info?.thinkingLevel });
      })
      .catch(() => {});
  };

  const openSession = async (c: JsonRpcClient, path: string, seqOverride?: number): Promise<void> => {
    const seq = seqOverride ?? ++openSessionSeq.current;
    // Fast path: if the session is already loaded in the store, skip the
    // `session.open` RPC entirely (no disk read, no JSONL parse). Only
    // fetchSessionInfo / refreshHistory run in the background.
    const pathToSid = new Map<string, string>();
    for (const s of sessions) pathToSid.set(s.path, s.id);
    const sidFromPath = pathToSid.get(path);
    const slot = sidFromPath ? state.slots[sidFromPath] : undefined;
    if (sidFromPath && slot && slot.items.length > 0) {
      setActivePath(path);
      autoscroll.resetSnap();
      dispatch({ type: "activate", sessionId: sidFromPath });
      fetchSessionInfo(c, sidFromPath);
      void refreshHistory(c);
      setFocusSignal((n) => n + 1);
      return;
    }

    openSessionLoadingRef.current++;
    setSessionLoading(true);
    // Clear the pane immediately + show the loading hint — the user sees
    // feedback on click, not after the RPC round-trip.
    dispatch({ type: "clearActive" });
    setShowLoading(true);
    try {
      setActivePath(path);
      const result = (await c.request("session.open", { sessionFile: path, limit: 200 })) as SessionOpenResult;
      // A newer click superseded this one — cache the messages but don't
      // steal the active session (prevents the UI jumping back/forth).
      const sid = result.sessionId;
      if (seq !== openSessionSeq.current) {
        const staleSlot = state.slots[sid];
        if (!staleSlot || staleSlot.items.length === 0) {
          dispatch({ type: "loadHistory", sessionId: sid, id: nextId(), messages: result.messages, hasMore: result.hasMore, total: result.total, startIndex: result.startIndex });
        }
        return;
      }
      // Multi-session: if the slot already has live-streamed content
      // (switching back to a running session), keep it — no reload.
      const loadedSlot = state.slots[sid];
      if (!loadedSlot || loadedSlot.items.length === 0) {
        dispatch({ type: "loadHistory", sessionId: sid, id: nextId(), messages: result.messages, hasMore: result.hasMore, total: result.total, startIndex: result.startIndex });
      }
      autoscroll.resetSnap(); // session switch — snap to bottom, don't animate
      dispatch({ type: "activate", sessionId: sid });
      if (result.sessionFile) setActivePath(result.sessionFile);
      fetchSessionInfo(c, sid);
      void refreshHistory(c);
      setFocusSignal((n) => n + 1); // focus the input bar after switching
    } catch (err) {
      dispatch({
        type: "localSystem",
        id: nextId(),
        text: `无法打开会话: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      openSessionLoadingRef.current--;
      if (openSessionLoadingRef.current <= 0) {
        openSessionLoadingRef.current = 0;
        setSessionLoading(false);
        setShowLoading(false);
      }
    }
  };

  /** Guard against overlapping session.page requests while scrolling up. */
  const loadingMoreHistoryRef = useRef(false);
  /** Drives the "加载更早消息…" indicator in ChatPane. */
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);

  /** Lazy-load an earlier page of the active session (scroll-up trigger). */
  const loadMoreHistory = useCallback(async (): Promise<void> => {
    if (!client || !state.activeId || loadingMoreHistoryRef.current) return;
    const sid = state.activeId;
    const slot = state.slots[sid];
    if (!slot?.historyHasMore || !slot.historyStartIndex || slot.items.length === 0) return;
    loadingMoreHistoryRef.current = true;
    setLoadingMoreHistory(true);
    const sessionFile = sessionFileBySessionId.current.get(sid) ?? activePath;
    try {
      const result = (await client.request("session.page", {
        sessionFile,
        limit: 200,
        beforeIndex: slot.historyStartIndex,
      })) as SessionPageResult;
      dispatch({ type: "prependHistory", sessionId: sid, id: nextId(), messages: result.messages, hasMore: result.hasMore, total: result.total, startIndex: result.startIndex });
    } catch {
      // non-fatal — the user can scroll up again
    } finally {
      loadingMoreHistoryRef.current = false;
      setLoadingMoreHistory(false);
    }
  }, [client, state.activeId, state.slots, activePath]);

  // Remember the active session so a reload lands back in the same chat.
  const lastSessionFirstRun = useRef(true);
  useEffect(() => {
    // Skip the initial mount — otherwise activePath is still undefined here
    // and this would wipe the stored session before restore reads it.
    if (lastSessionFirstRun.current) {
      lastSessionFirstRun.current = false;
      return;
    }
    try {
      if (activePath) localStorage.setItem(LAST_SESSION_KEY, activePath);
      else localStorage.removeItem(LAST_SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [activePath]);

  // Restore the last active session once the daemon connection is up.
  useEffect(() => {
    if (!client || restoreDone.current) return;
    restoreDone.current = true;
    let last: string | undefined;
    try {
      last = localStorage.getItem(LAST_SESSION_KEY) ?? undefined;
    } catch {
      last = undefined;
    }
    if (!last) return;
    void (async () => {
      try {
        await openSession(client, last);
      } catch {
        // Session gone (archived/rotated) — stay on the welcome screen.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // ── sending / editing ──────────────────────────────────────────────────
  /**
   * Routes a web-native builtin slash command to its engine RPC (or frontend
   * action). Returns false for non-builtin commands so they fall through to
   * session.prompt() (which dispatches extension commands and expands
   * /skill: and /template commands).
   */
  const routeBuiltin = (name: string): boolean => {
    switch (name) {
      case "compact":
        void compact();
        return true;
      case "reload":
        // Give visible feedback — the engine rebuilds the extension runtime,
        // which is silent from the frontend's perspective.
        setUiToast({ text: "正在重新加载扩展与技能…", type: "info" });
        if (uiToastTimer.current) clearTimeout(uiToastTimer.current);
        uiToastTimer.current = setTimeout(() => setUiToast(null), 2500);
        if (client && state.activeId) {
          void client
            .request("session.reload", { sessionId: state.activeId })
            .then(() => {
              refreshCommands(); // re-list commands (new extensions may have registered more)
              setUiToast({ text: "✅ 已重新加载扩展与技能", type: "info" });
              if (uiToastTimer.current) clearTimeout(uiToastTimer.current);
              uiToastTimer.current = setTimeout(() => setUiToast(null), 2500);
            })
            .catch((err: unknown) => {
              setUiToast({ text: `reload 失败：${err instanceof Error ? err.message : String(err)}`, type: "error" });
              if (uiToastTimer.current) clearTimeout(uiToastTimer.current);
              uiToastTimer.current = setTimeout(() => setUiToast(null), 4000);
            });
        }
        return true;
      default:
        return false;
    }
  };

  const sendMessage = (text: string, images: Array<{ dataUrl: string; mimeType: string }>): void => {
    // Remember the original /skill:… command so the expanded echo can be
    // swapped back for display/copy (the full SKILL.md is still sent).
    if (text.trim().startsWith("/skill:")) pendingSkillTexts.current.push(text.trim());
    if (!client) return;
    void (async () => {
      try {
        // Route web-native builtins (compact) to engine RPCs — session.prompt()
        // won't dispatch pi's TUI-only builtin commands.
        const first = text.split(/\s+/)[0] ?? "";
        if (first.startsWith("/") && routeBuiltin(first.slice(1))) return;
        let sid = state.activeId;
        if (!sid || sid === WELCOME_SLOT) {
          const created = (await client.request("session.create", { cwd: activeProject ?? undefined })) as { sessionId: string };
          sid = created.sessionId;
          // Carry the "新会话" hint into the fresh slot before activating it.
          if (state.slots[WELCOME_SLOT]?.items.length) {
            dispatch({ type: "moveWelcome", sessionId: sid });
          }
          dispatch({ type: "activate", sessionId: sid });
          // New session — fetch its sessionFile so the last-session memory
          // can restore it on the next app load.
          fetchSessionInfo(client, sid);
          if (pendingModel) {
            try {
              await client.request("session.model.set", { sessionId: sid, providerId: pendingModel.providerId, modelId: pendingModel.modelId });
            } catch {
              // non-fatal
            }
            setPendingModel(undefined);
          }
          void refreshHistory(client);
        }
        await client.request("session.prompt", { sessionId: sid, text, images });
        void refreshHistory(client);
      } catch (err) {
        dispatch({ type: "forceIdle" });
        dispatch({
          type: "localSystem",
          id: nextId(),
          text: `error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
  };

  /** Submit an edited user message (same as prompt, no attachments). */
  const editSubmit = (text: string): void => {
    sendMessage(text, []);
  };

  /** 派生：从这条用户消息创建一条全新会话（含到此为止的上下文，原会话不动）。 */
  // Stable ref so the (memoized) fork button always invokes the LATEST runFork
  // closure — the confirm dialog is set up once on mount, when `client` is
  // still null, so a plain closure would capture the first render's null.
  const runForkRef = useRef<(matchText: string, displayText: string) => void>(() => {});

  const forkFrom = useCallback((messageId: number, matchText: string, displayText: string): void => {
    // 先弹确认框，防止误点
    confirm("派生新会话", "从这条消息开始创建一条新的会话，原会话保持不变。\n新会话只包含到此为止的上下文。", "确认派生", () => {
      void runForkRef.current(matchText, displayText);
    });
  }, [confirm]);

  const runFork = useCallback(async (matchText: string, displayText: string): Promise<void> => {
    const c = client;
    const sid = state.activeId;
    if (!c || !sid) return;
    // 即时反馈：确认后立刻提示，避免“点了没反应”的错觉
    setUiToast({ text: "正在派生新会话…", type: "info" });
    if (uiToastTimer.current) clearTimeout(uiToastTimer.current);
    try {
      // Find this message's session entry by matching fork points (text-based;
      // frontend message ids are synthetic and don't map to session entry ids).
      const points = (await c.request("session.forkPoints", { sessionId: sid })) as Array<{ entryId: string; text: string }> | undefined;
      // Normalise both texts so minor whitespace differences don't break
      // matching: trim + collapse consecutive whitespace into single space.
      const target = (points ?? []).findLast((p) => normText(p.text) === normText(matchText));
      if (!target) {
        // 失败时显示前 3 个 fork 点文本和用户文本的差异，帮助诊断
        const samples = (points ?? []).slice(0, 3).map((p) => JSON.stringify(p.text.slice(0, 60))).join(", ");
        setUiToast({ text: `未找到匹配的派生点 (${(points ?? []).length} 个点，样本: ${samples})`, type: "error" });
        console.log("[fork] match failed. user text:", JSON.stringify(matchText), "| normText:", normText(matchText));
        console.log("[fork] first 3 fork points:", (points ?? []).slice(0, 3).map((p) => ({ id: p.entryId, text: p.text.slice(0, 80) })));
        return;
      }
      // Create a brand-new session forked at this message (backend writes a
      // new JSONL with context up to this entry; original session untouched).
      const created = (await c.request("session.fork", { sessionId: sid, entryId: target.entryId })) as { sessionId: string; cwd: string; sessionFile: string } | undefined;
      if (!created?.sessionId) {
        setUiToast({ text: "派生失败：daemon 未返回新会话", type: "error" });
        return;
      }
      // 派生后自动命名：原名称 (n)，n 为当前同源会话数 + 1
      const sourceSession = sessions.find((s) => s.id === sid || s.path === activePath);
      const baseName = sourceSession?.name || sourceSession?.firstMessage || "新会话";
      const nameCount = sessions.filter((s) => (s.name || s.firstMessage || "").startsWith(baseName)).length;
      const newName = `${baseName} (${nameCount + 1})`;
      try {
        await c.request("session.renameFile", { sessionFile: created.sessionFile, name: newName });
      } catch { /* non-fatal */ }
      // Refresh the sidebar so the new session appears, then open it.
      void refreshHistory(c);
      const result = (await c.request("session.open", { sessionFile: created.sessionFile, limit: 200 })) as SessionOpenResult;
      dispatch({ type: "loadHistory", sessionId: created.sessionId, id: nextId(), messages: result.messages, hasMore: result.hasMore, total: result.total, startIndex: result.startIndex });
      dispatch({ type: "activate", sessionId: created.sessionId });
      setActivePath(created.sessionFile);
      void refreshHistory(c);
      autoscroll.resetSnap();
      // Pre-fill the input with the user-friendly form of the forked message
      // (e.g. "/skill:xxx" for skill messages, not the expanded skill body).
      inputState.setInput(displayText);
      setUiToast({ text: "✅ 新会话已派生，可编辑消息后发送", type: "info" });
      if (uiToastTimer.current) clearTimeout(uiToastTimer.current);
      uiToastTimer.current = setTimeout(() => setUiToast(null), 2500);
    } catch (err) {
      console.log("[fork] failed:", String(err));
      setUiToast({ text: `派生失败：${err instanceof Error ? err.message : String(err)}`, type: "error" });
      if (uiToastTimer.current) clearTimeout(uiToastTimer.current);
      uiToastTimer.current = setTimeout(() => setUiToast(null), 4000);
    }
  }, [client, state.activeId, dispatch, refreshHistory, setActivePath, autoscroll, sessions, activePath, setUiToast, uiToastTimer, inputState]);
  // Keep the stable ref pointing at the latest closure (see runForkRef above).
  runForkRef.current = runFork;

  /** Undo a whole turn's file changes (atomic batch — blocked if any file was hand-edited). */
  const revertAll = useCallback(async (files: string[]): Promise<void> => {
    if (!client || !state.activeId || files.length === 0) return;
    try {
      const res = (await client.request("tool.revertBatch", { sessionId: state.activeId, files })) as {
        ok?: boolean;
        results?: Array<{ file: string; ok: boolean; error?: string }>;
      } | undefined;
      const results = (res?.results ?? []).map((r) => ({ file: r.file, toolCallId: r.file, ok: r.ok, error: r.error }));
      setRevertReport({ results });
    } catch (err) {
      console.log("[frontend revertBatch catch]", String(err));
      setRevertReport({
        results: files.map((f) => ({
          file: f, toolCallId: f, ok: false,
          error: err instanceof Error ? err.message : String(err),
        })),
      });
    }
  }, [client, state.activeId, setRevertReport]);

  // ── session actions ────────────────────────────────────────────────────
  const newSession = (): void => {
    autoscroll.resetSnap(); // fresh chat — snap, don't animate
    dispatch({ type: "activate", sessionId: undefined });
    setActivePath(undefined);
    setFocusSignal((n) => n + 1); // focus the input on the welcome screen
  };

  const renameSession = async (path: string, name: string): Promise<void> => {
    if (!client) return;
    try {
      await client.request("session.renameFile", { sessionFile: path, name });
      void refreshHistory(client);
    } catch {
      // rename failure is non-fatal; keep the old name
    }
  };

  const deleteSession = async (path: string): Promise<void> => {
    if (!client) return;
    try {
      const target = sessions.find((s) => s.path === path);
      await client.request("session.delete", { sessionFile: path, sessionId: target?.id });
      // If the deleted session is the active one, clear it.
      if (activePath === path) {
        dispatch({ type: "activate", sessionId: undefined });
        setActivePath(undefined);
      }
      void refreshHistory(client);
    } catch {
      // non-fatal
    }
  };

  const archiveSession = async (path: string): Promise<void> => {
    if (!client) return;
    try {
      await client.request("session.archive", { sessionFile: path });
      // Optimistic: drop it from the active list now; refreshHistory (which
      // re-parses every session JSONL) runs in the background.
      setSessions((prev) => prev.filter((s) => s.path !== path));
      if (activePath === path) {
        dispatch({ type: "activate", sessionId: undefined });
        setActivePath(undefined);
      }
      void refreshHistory(client);
      void archiving.syncArchived(client);
    } catch {
      // non-fatal
    }
  };

  const restoreSession = async (path: string): Promise<void> => {
    if (!client) return;
    try {
      await client.request("session.restore", { sessionFile: path });
      archiving.removeArchivedSession(path);
      void refreshHistory(client);
      void archiving.syncArchived(client);
    } catch {
      // non-fatal
    }
  };


  const togglePin = async (path: string): Promise<void> => {
    if (!client) return;
    try {
      const pinned = pinnedSessions.has(path);
      await client.request("session.pin", { sessionFile: path, pinned: !pinned });
      setPinnedSessions((prev) => {
        const next = new Set(prev);
        if (pinned) next.delete(path);
        else next.add(path);
        return next;
      });
      void refreshHistory(client);
    } catch {
      // non-fatal
    }
  };

  // ── derived values ─────────────────────────────────────────────────────
  const projects = useMemo<ProjectOption[]>(() => {
    const seen = new Set<string>();
    const out: ProjectOption[] = [];
    for (const s of sessions) {
      if (seen.has(s.cwd)) continue;
      seen.add(s.cwd);
      const parts = s.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
      out.push({ id: s.cwd, name: parts[parts.length - 1] ?? s.cwd, available: true });
    }
    return out;
  }, [sessions]);

  /** Session-file paths whose agent is running (sidebar busy dots). */
  const busyPaths = useMemo(() => {
    const out = new Set<string>();
    for (const [sid, slot] of Object.entries(state.slots)) {
      if (slot.busy) {
        const f = sessionFileBySessionId.current.get(sid);
        if (f) out.add(f);
      }
    }
    return out;
  }, [state.slots]);


  // Model pickers only show enabled providers; the selected model defaults
  // to the active slot's model, falling back to the welcome-screen choice.
  const selectedModel = active.info?.model ?? pendingModel?.modelId;

  // ── daemon event routing → session slots (side effects only for the
  // visible session; every session's slot still gets its own updates).
  const handleUiRequest = (event: UiRequestEvent): void => {
    if (event.method === "widgetLines") {
      // Persistent widget panel (setWidget). Empty lines → remove.
      setUiWidgets((prev) => {
        const key = event.widgetKey ?? "";
        if (!key) return prev;
        const next = { ...prev };
        if (!event.lines || event.lines.length === 0) delete next[key];
        else {
          // Normalise: event.lines may be an array (each element = one line) or
          // a single string with embedded newlines.  Either way, split into rows.
          const raw = Array.isArray(event.lines) ? event.lines : String(event.lines ?? "").split("\n");
          next[key] = { lines: raw, placement: event.placement ?? "aboveEditor", sessionId: event.sessionId };
        }
        return next;
      });
      return;
    }
    if (event.method === "setStatus") {
      // Persistent status strip (key → text). null/undefined clears the item.
      setUiStatuses((prev) => {
        const key = event.statusKey ?? "";
        if (!key) return prev;
        const next = { ...prev };
        if (event.statusText == null) delete next[key];
        else next[key] = event.statusText;
        return next;
      });
      return;
    }
    if (event.method === "notify") {
      // Fire-and-forget notification — show a transient toast.
      setUiToast({ text: event.message ?? event.title ?? "", type: event.notifyType ?? "info" });
      if (uiToastTimer.current) clearTimeout(uiToastTimer.current);
      uiToastTimer.current = setTimeout(() => setUiToast(null), 3500);
      return;
    }
    if (!client) return;
    const sid = event.sessionId ?? "global";
    // Append an inline card to THIS session's stream. It stays there as a
    // message (pending until answered); switching sessions shows each
    // session's own cards naturally.
    setUiCards((prev) => ({
      ...prev,
      [sid]: [...(prev[sid] ?? []), { event, sessionId: event.sessionId, status: "pending" }],
    }));
  };

  /** User answered an inline UI card — mark it answered (read-only) and send ui.respond. */
  /** One-shot “follow the agent’s next reply” flag: set when the user answers
   *  a card; the next streamed message consumes it and scrolls to bottom.
   *  Auto-scroll is intentionally limited to (1) this and (2) sending a
   *  message — nothing else drags the viewport. */
  const followAnswerRef = useRef(false);

  const onUiCardRespond = (card: UiCardItem, result: { confirmed?: boolean; value?: string; cancelled?: boolean }): void => {
    const sid = card.sessionId ?? "global";
    setUiCards((prev) => ({
      ...prev,
      [sid]: (prev[sid] ?? []).map((c) =>
        c.event.id === card.event.id ? { ...c, status: "answered" as const, result } : c,
      ),
    }));
    // Scenario (1): answering a card → follow the agent's reply.
    followAnswerRef.current = true;
    void client?.request("ui.respond", { id: card.event.id, ...result }).catch(() => {});
  };

  useDaemonEvents({
    client,
    registerOnEvent,
    followAnswerRef,
    dispatch,
    nextId,
    activeId: state.activeId,
    autoscroll,
    effects: { fetchSessionInfo, refreshHistory, setUsageStats, onUiRequest: handleUiRequest, shiftSkillText: () => pendingSkillTexts.current.shift() },
  });

  // ── connect: initial RPCs ──────────────────────────────────────────────
  useEffect(() => {
    if (!client) return;
    void client
      .request("ping")
      .then(() => {})
      .catch(() => {});
    void models.refreshModels();
    void client
      .request("usage.stats", {})
      .then((result) => setUsageStats(result as UsageStatsUI))
      .catch(() => {});
    void client
      .request("session.pins")
      .then((result) => {
        if (Array.isArray(result)) setPinnedSessions(new Set(result as string[]));
      })
      .catch(() => {});
    // Re-hydrate extension widgets after a reload (engine caches latest lines).
    void client
      .request("ui.widgets", {})
      .then((result) => {
        const w = result as Record<string, { lines?: string[]; placement?: string; sessionId?: string }> | undefined;
        if (w) {
          const next: Record<string, { lines: string[]; placement: "aboveEditor" | "belowEditor"; sessionId?: string }> = {};
          for (const [k, v] of Object.entries(w)) {
            if (v?.lines && v.lines.length > 0) {
              next[k] = { lines: v.lines, placement: v.placement === "belowEditor" ? "belowEditor" : "aboveEditor", sessionId: v.sessionId };
            }
          }
          setUiWidgets(next);
        }
      })
      .catch(() => {});
    // Re-hydrate extension UI cards after a reload — PENDING asks (still
    // awaiting a response, engine memory) + ANSWERED history (disk-backed,
    // survives daemon restarts). Cards are grouped by session.
    void client
      .request("ui.pending", {})
      .then((result) => {
        const arr = result as Array<{ id: string; request: Record<string, unknown> }> | undefined;
        if (arr && arr.length > 0) {
          const next: Record<string, UiCardItem[]> = {};
          for (const req of arr) {
            const event = req.request as unknown as UiRequestEvent;
            const sid = event.sessionId ?? "global";
            next[sid] = [
              ...(next[sid] ?? []),
              { event, sessionId: event.sessionId, status: "pending" },
            ];
          }
          setUiCards(next);
        }
      })
      .catch(() => {});
    // Durable answered-card history: read from disk (~/.pi/agent/ui-history),
    // so after a daemon RESTART the answered cards still show in each session.
    void client
      .request("ui.history", {})
      .then((result) => {
        const hist = result as Record<string, Array<{ request: Record<string, unknown>; result: Record<string, unknown> }>> | undefined;
        if (hist) {
          setUiCards((prev) => {
            const next = { ...prev };
            for (const [sid, records] of Object.entries(hist)) {
              const cards: UiCardItem[] = records.map((r) => ({
                event: r.request as unknown as UiRequestEvent,
                sessionId: (r.request as unknown as UiRequestEvent).sessionId,
                status: "answered",
                result: r.result as UiCardItem["result"],
              }));
              next[sid] = [...(next[sid] ?? []), ...cards];
            }
            return next;
          });
        }
      })
      .catch(() => {});
    void archiving.syncArchived(client);
    void refreshHistory(client);
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture-phase blur: clicking anywhere that is NOT an input/button drops
  // focus immediately (before the browser paints a caret), so no stray "|"
  // ever flickers outside the textarea. No preventDefault — that would block
  // text-selection on mousedown.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, button, [role='menu'], [role='menuitem'], [contenteditable]")) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement) focused.blur();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  // ── project selection ──────────────────────────────────────────────────
  const selectProject = (id: string): void => {
    setActiveProject(id);
    localStorage.setItem("vagus.activeProject", id);
  };

  useEffect(() => {
    const saved = localStorage.getItem("vagus.activeProject");
    if (saved) setActiveProject(saved);
  }, []);

  const pickFolder = async (path: string | null): Promise<void> => {
    setPickerOpen(false);
    if (!path || !client) return;
    setActiveProject(path);
    localStorage.setItem("vagus.activeProject", path);
    try {
      const created = (await client.request("session.create", { cwd: path })) as { sessionId: string };
      dispatch({ type: "activate", sessionId: created.sessionId });
      void refreshHistory(client);
      setFocusSignal((n) => n + 1);
    } catch {
      // non-fatal
    }
  };

  const switchModel = async (providerId: string, modelId: string): Promise<void> => {
    // Remember the choice regardless — on the welcome screen there's no
    // session yet, so it's applied right after session.create.
    setPendingModel({ providerId, modelId });
    if (state.activeId) {
      dispatch({
        type: "setInfo",
        sessionId: state.activeId,
        info: active.info ? { ...active.info, model: modelId, activeProvider: providerId } : undefined,
      });
    }
    if (!client || !state.activeId) return;
    try {
      await client.request("session.model.set", { sessionId: state.activeId, providerId, modelId });
    } catch {
      // non-fatal
    }
  };

  const stopAgent = (): void => {
    if (!client || !state.activeId) return;
    void client.request("session.abort", { sessionId: state.activeId }).catch(() => {});
  };

  const abortCompaction = (): void => {
    if (!client || !state.activeId) return;
    void client.request("session.abortCompaction", { sessionId: state.activeId }).catch(() => {});
  };

  const setThinking = async (level: string): Promise<void> => {
    if (state.activeId) {
      dispatch({ type: "setInfo", sessionId: state.activeId, info: active.info, thinkingLevel: level });
    }
    if (!client || !state.activeId) return;
    try {
      await client.request("session.thinking.set", { sessionId: state.activeId, level });
    } catch {
      // non-fatal
    }
  };

  const compact = async (): Promise<void> => {
    if (!client || !state.activeId) return;
    const sid = state.activeId;
    const loadingId = nextId();
    setCompacting(true);
    dispatch({ type: "localSystem", id: loadingId, text: "正在压缩上下文…" });
    try {
      const result = (await client.request("session.compact", { sessionId: sid })) as { estimatedTokensAfter?: number };
      // Drop the loading marker, then show the post-compaction token count.
      dispatch({ type: "removeMessage", id: loadingId });
      const after = result?.estimatedTokensAfter;
      const afterK = typeof after === "number" && after > 0 ? `${(after / 1000).toFixed(1)}K` : "";
      // Immediately shrink the context ring — pi's getContextUsage() can't
      // know the new size until the next response, so we seed it ourselves.
      setContextOverride(typeof after === "number" ? after : null);
      dispatch({
        type: "localSystem",
        id: nextId(),
        text: `◌ 前文已摘要${afterK ? ` · 剩余 ${afterK} 上下文` : ""}`,
      });
      // Refresh token/usage indicators — compaction shrinks the context.
      fetchSessionInfo(client, sid);
      void client
        .request("usage.stats", {})
        .then((usage) => setUsageStats(usage as UsageStatsUI))
        .catch(() => {});
    } catch (err) {
      dispatch({ type: "removeMessage", id: loadingId });
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = msg.includes("Nothing to compact") || msg.includes("Already compacted")
        ? "上下文还没大到需要压缩（会话内容太少，或刚刚已经压缩过）"
        : `压缩失败：${msg}`;
      dispatch({ type: "localSystem", id: nextId(), text: friendly });
    } finally {
      setCompacting(false);
    }
  };

  // ── folder picker / command picker RPCs ────────────────────────────────
  const roots = async (): Promise<{ places: { name: string; path: string; isDirectory: boolean }[]; drives: { name: string; path: string; isDirectory: boolean }[] }> => {
    if (!client) return { places: [], drives: [] };
    return (await client.request("project.roots", {})) as { places: { name: string; path: string; isDirectory: boolean }[]; drives: { name: string; path: string; isDirectory: boolean }[] };
  };

  const listDir = async (dir: string): Promise<{ path: string; entries: { name: string; path: string; isDirectory: boolean }[] }> => {
    if (!client) return { path: dir, entries: [] };
    return (await client.request("project.listDir", { dir })) as { path: string; entries: { name: string; path: string; isDirectory: boolean }[] };
  };

  /** Fetches the full command palette from the daemon (extension + template + skill) + merges builtins. */
  const listCommands = async (): Promise<CommandInfo[]> => {
    if (!client) return WEB_BUILTIN_COMMANDS;
    try {
      const res = (await client.request("commands.list", {
        sessionId: state.activeId ?? undefined,
      })) as { extensions: { name: string; description?: string }[]; templates: { name: string; description?: string }[]; skills: { name: string; description?: string }[] };
      return [
        ...WEB_BUILTIN_COMMANDS,
        ...(res.extensions ?? []).map((e) => ({ type: "extension" as const, name: e.name, description: e.description ?? "" })),
        ...(res.templates ?? []).map((tmpl) => ({ type: "template" as const, name: tmpl.name, description: tmpl.description ?? "" })),
        ...(res.skills ?? []).map((s) => ({ type: "skill" as const, name: `skill:${s.name}`, description: s.description ?? "" })),
      ];
    } catch {
      return WEB_BUILTIN_COMMANDS;
    }
  };

  // Refresh the command palette when the active session changes (extension
  // commands come from the session's extension runner) AND whenever the
  // palette is opened (settings/skill changes should show immediately).
  useEffect(() => {
    if (!client) return;
    void listCommands().then(setCommands).catch(() => setCommands(WEB_BUILTIN_COMMANDS));
  }, [client, state.activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Re-fetch the command palette on demand (opening the picker / typing "/"). */
  const refreshCommands = (): void => {
    void listCommands().then(setCommands).catch(() => setCommands(WEB_BUILTIN_COMMANDS));
  };

  const pickCommand = (cmd: string | null): void => {
    setCommandOpen(false);
    if (cmd) inputState.setInput((prev) => `${prev}${cmd} `);
  };

  // ── shared input-card props (welcome + chat) ───────────────────────────
  const inputCard = {
    value: inputState.input,
    onChange: inputState.setInput,
    onSubmit: () =>
      inputState.submit((text, images) => {
        autoscroll.forceScrollToBottom(false, 750); // smooth scroll down when sending
        sendMessage(text, images);
      }),
    usage: active.info
      ? contextOverride !== null
        ? { ...active.info, contextUsage: { tokens: contextOverride, contextWindow: active.info.contextUsage?.contextWindow ?? 1_000_000, percent: null } }
        : active.info
      : null,
    providers: enabledProviders,
    onSwitchModel: (pid: string, mid: string) => void switchModel(pid, mid),
    onSetThinking: (lv: string) => void setThinking(lv),
    thinkingLevel: active.thinkingLevel ?? "low",
    permissionMode,
    onTogglePermission: () => setPermissionMode((m) => (m === "ask" ? "auto" : "ask")),
    attachments: inputState.attachments,
    fileAttachments: inputState.fileAttachments,
    onAttach: inputState.attachFiles,
    onRemoveAttachment: inputState.removeAttachment,
    busy: active.busy || compacting,
    onStop: compacting ? abortCompaction : stopAgent,
    // A ctx.ui card awaiting a response → the send button becomes a
    // “respond” button (only when this session has a pending card).
    hasPendingDialog: activeCards.some((c) => c.status === "pending"),
    selectedModel,
    onCommand: () => { refreshCommands(); setCommandOpen(true); },
    onRefreshCommands: refreshCommands,
    commands,
    onPickCommand: () => {},
    focusSignal,
    queuedMessages: active.queued,
  };

  // Sidebar collapsed → chat/welcome content widens to reclaim the space.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarProps = {
    sessions,
    activePath,
    onNewSession: newSession,
    onCollapsedChange: setSidebarCollapsed,
    onClearAllArchived: () => archiving.clearAllArchived(),
    onOpenSession,
    onOpenSettings: () => setSettingsOpen(true),
    onOpenPlugins: () => setPluginsOpen(true),
    onRenameSession: renameSession,
    onDeleteSession: deleteSession,
    onArchiveSession: archiveSession,
    onRestoreSession: restoreSession,
    onDeleteArchivedSession: archiving.deleteArchivedSession,
    onTogglePin: togglePin,
    pinnedSessions,
    archivedProjects,
    onArchiveProject: async (cwd: string) => {
      // Optimistic: drop the project's sessions from the active list now.
      setSessions((prev) => prev.filter((s) => s.cwd !== cwd));
      await archiving.archiveProject(cwd);
    },
    onUnarchiveProject: async (dirKey: string) => {
      archiving.removeArchivedProject(dirKey);
      await archiving.unarchiveProject(dirKey);
    },
    onDeleteProject: (dirKey: string) => archiving.deleteProject(dirKey, sessions, activePath),
    busyPaths,
    pendingDialogPaths: new Set(
      Object.entries(uiCards)
        .filter(([, cards]) => cards.some((c) => c.status === "pending"))
        .map(([sid]) => sessionFileBySessionId.current.get(sid))
        .filter((p): p is string => !!p),
    ),
  };

  const { uiFontSize } = useAppearance();
  const welcomeView = !state.activeId && !settingsOpen && !sessionLoading;
  // 中间栏顶栏：当前对话的名称 + 工作目录
  const activeSession = sessions.find((s) => s.path === activePath);
  const activeSessionName = activeSession?.name ?? activeSession?.firstMessage ?? "";
  const activeSessionCwd = activeSession?.cwd;

  return (
    <div style={{ height: "100dvh", margin: 0, display: "flex", overflow: "hidden", background: t.color.bg, color: t.color.fg, fontFamily: t.font.sans, fontSize: uiFontSize }}>
      {settingsOpen ? (
        /* 设置页全屏两栏 —— 隐藏侧栏 */
        <Suspense fallback={null}><SettingsView providers={modelsConfig} usageStats={usageStats} onClose={() => setSettingsOpen(false)} onSave={models.saveModels} onRefresh={models.refreshModels} onTest={models.testModel} cat={settingsCat} onCatChange={setSettingsCat} projectCwd={activeProject}
          request={(method, params) => client!.request(method, params)}
          onProbe={async (params: { baseUrl: string; api: string; apiKey?: string; model: string }) => (client ? (await client.request("models.probe", params)) as { ok: boolean; compat?: Record<string, unknown>; input?: string[]; reasoning?: boolean; error?: string } : { ok: false })} /></Suspense>
      ) : pluginsOpen ? (
        /* 插件市场全屏 —— 隐藏侧栏，返回回首页 */
        <Suspense fallback={null}><PluginsView request={(method, params) => client!.request(method, params)} onClose={() => setPluginsOpen(false)} t={t} /></Suspense>
      ) : welcomeView ? (
        /* 欢迎页：侧栏 + 品牌问候区 + 项目选择器 + 输入卡 */
        <div style={{ flex: 1, display: "flex", flexDirection: "row", minWidth: 0 }}>
          <SessionSidebar {...sidebarProps} />
          <WelcomePane wide={sidebarCollapsed} activeProject={activeProject} projects={projects} onSelectProject={selectProject} onNewProject={() => setPickerOpen(true)} inputCard={inputCard} aboveEditorWidgets={aboveEditorWidgets} aboveEditorStatuses={uiStatuses} />
        </div>
      ) : (
        /* 对话页：侧栏 + 聊天流 + 右视图（可插拔） */
        <div style={{ flex: 1, display: "flex", flexDirection: "row", minWidth: 0 }}>
          <SessionSidebar {...sidebarProps} />
          <ChatPane
            wide={sidebarCollapsed}            items={active.items}
            busy={active.busy}
            turnStartTs={active.turnStart}
            sessionLoading={sessionLoading}
            showLoading={showLoading}
            autoscroll={autoscroll}
            sessionName={activeSessionName}
            sessionCwd={activeSessionCwd}
            activeId={state.activeId}
            onToggleCard={(id: number) => dispatch({ type: "toggleCollapse", id })}
            copyMessage={copyMessage}
            editSubmit={editSubmit}
            onFork={forkFrom}
            inputCard={inputCard}
            uiCards={activeCards}
            onUiCardRespond={onUiCardRespond}
            onLoadMore={loadMoreHistory}
            loadingMore={loadingMoreHistory}
            aboveEditorWidgets={aboveEditorWidgets}
            aboveEditorStatuses={uiStatuses}
            onOpenFile={openFileDiff}
            onRevertAll={(files: string[]) => void revertAll(files)}
          />
          <RightPanel
              tabs={rightTabs}
              activeId={rightTabId}
              collapsed={rightCollapsed}
              onActivate={(id) => setRightTabId(id)}
              onClose={(id) => closeRightTab(id)}
              onToggleCollapse={() => setRightCollapsed((c) => !c)}
              width={rightPanelWidth}
              onWidthChange={setRightPanelWidth}
              render={(tab) => {
                if (tab.id === "diff") {
                  return (
                    <DiffTabContent
                      key={`${state.activeId}-${reviewTurnId ?? "none"}`}
                      items={active.items}
                      selected={diffSelection}
                      turnId={reviewTurnId}
                      expandedFiles={reviewOpen}
                      onOpenChange={(files) => setReviewOpen(files)}
                    />
                  );
                }
                if (tab.id === "widget") {
                  return <WidgetPanelContent widgets={activeWidgets} />;
                }
                return null;
              }}
            />
        </div>
      )}

      {pickerOpen && <FolderPicker listDir={listDir} roots={roots} onPick={(p) => void pickFolder(p)} />}

      {commandOpen && <CommandPicker commands={commands} onPick={pickCommand} />}

      {confirmState && <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />}

      {/* Toast notifications — anchored above the input area (position: fixed).
          Extension status texts are rendered by ChatPane/WelcomePane above the
          input via the aboveEditorStatuses prop, so only the transient toast
          lives here. */}
      {uiToast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 10001, display: "flex", alignItems: "flex-start", gap: 9, padding: "10px 16px", borderRadius: 12, background: t.color.surface, border: `1px solid ${t.color.border}`, boxShadow: "0 12px 40px rgba(0,0,0,0.25)", fontSize: "0.88em", color: t.color.fg, animation: "vagus-toast-in 0.2s ease", maxWidth: "min(90vw, 560px)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 5, background: uiToast.type === "error" ? "#E5484D" : uiToast.type === "warning" ? "#B7791F" : t.color.primary }} />
          <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{uiToast.text}</span>
        </div>
      )}

      {revertReport && <RevertReportModal report={revertReport} onClose={() => setRevertReport(null)} />}
    </div>
  );
}