import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type {
  AgentSession,
  CompactionResult,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { EventBus } from "@vagus/host-events";
import type { CoreEventMap } from "@vagus/host-events";
import type { SessionHistoryItem, SessionMessage, UsageStats } from "@vagus/protocol";
import { computeToolDiff, extractToolDiff, extractToolPatch, extractToolPath, messageToText, parseContentBlocks, serializeToolArg, sessionEntryPreview, toolResultText, truncateDisplay } from "./display-utils.js";
import type { HistoryMessageLike, SessionEntryLike } from "./display-utils.js";
import { aggregateUsageStats } from "./usage-stats.js";
import { ExtensionUiBridge } from "./ui-bridge.js";

/**
 * VagusEngine — the session engine (ADR-002/ADR-005).
 *
 * Wraps pi's SDK (`createAgentSession`) behind the engine's event bus and
 * session store. The model runtime is created *lazily* on the first session
 * so the daemon can boot without any provider credentials (users' existing
 * `~/.pi` auth is picked up automatically when a session is created).
 *
 * Sessions are pi's own append-only JSONL trees under the engine dir:
 * `createSession` starts a fresh tree, `resumeSession` reopens an existing
 * file (full context restored via SessionManager.open) — so the GUI's session
 * tree shows *real* history, not stubs.
 */

export interface ActiveSession {
  sessionId: string;
  cwd: string;
  /** Underlying session file on disk (undefined for test/in-memory sessions). */
  sessionFile?: string;
}

export interface VagusEngineOptions {
  /** Working directory for pi's session manager. */
  cwd: string;
  bus: EventBus<CoreEventMap>;
  /** Engine config dir. Maps to pi's agentDir. Defaults to `~/.pi/agent`. */
  engineDir?: string;
  /** Injectable for tests. */
  modelRuntime?: ModelRuntime;
  /** Injectable for tests. */
  sessionManager?: SessionManager;
  /** Injectable for tests; defaults to pi's `createAgentSession`. */
  sessionFactory?: SessionFactory;
  /**
   * Names of global skills the user has disabled. When non-empty, the engine
   * builds the pi resource-loader with a `skillsOverride` that filters these
   * out of every session (so they never enter the system prompt). Falls back
   * to pi's default loader (no filtering) when empty/undefined.
   */
  disabledSkills?: () => string[];
  /**
   * Built-in extension paths loaded session-scoped (via the resource
   * loader's additionalExtensionPaths) — the web GUI's own capabilities
   * (MCP). These are NEVER written to settings.json so
   * other pi frontends (CLI, agent studio) stay unaffected.
   */
  builtinExtensionPaths?: string[];
}

export type SessionFactory = (
  options: CreateAgentSessionOptions,
) => Promise<CreateAgentSessionResult>;

/** A file's pre-session baseline plus the content after the agent's last edit. */
interface FileBaseline {
  /** Content before the session's first edit of this file (revert target). */
  content: string;
  /** Whether the file existed before the session edited it. */
  exists: boolean;
  /** Content right after the agent's most recent edit of this file. */
  lastContent?: string;
}

export class VagusEngine {
  private readonly sessions = new Map<string, AgentSession>();
  /**
   * Pre-tool file contents keyed by toolCallId, captured at tool_execution_start
   * for path-carrying tools (write/edit/multi_edit). Lets the engine compute its
   * own diff at tool end for tools that don't return pi's details.diff (e.g. write).
   */
  private readonly toolBaselines = new Map<string, { path: string; content: string }>();
  /**
   * Per-session file baselines for revert: sessionId → absPath → content as it
   * was BEFORE this session's first edit of that file. `exists: false` means
   * the file did not exist (revert deletes it). `lastContent` is the content
   * right after the agent's most recent edit — revert refuses to overwrite a
   * file the user has hand-modified since (current != lastContent). This is
   * the git-free checkpoint mechanism — restoring writes the snapshot back.
   */
  private readonly fileBaselines = new Map<string, Map<string, FileBaseline>>();
  private runtimePromise: Promise<ModelRuntime> | undefined;
  private readonly uiBridge: ExtensionUiBridge;

  constructor(private readonly options: VagusEngineOptions) {
    this.uiBridge = new ExtensionUiBridge(this.options.bus, () => this.agentDirPath());
  }

  /**
   * Extension UI bridge — lets web sessions answer `ctx.ui.confirm/select/
   * input` from extensions (pi RPC-style extension_ui_request sub-protocol).
   *
   * Each dialog emits a `ui.request` bus event (forwarded to the GUI over
   * WebSocket); the frontend renders the dialog and calls `resolveUi()` via
   * the `ui.respond` RPC. Fire-and-forget methods (notify/…) are forwarded
   * as events with no pending promise.
   */
  createUiContext(sessionId: string): ExtensionUIContext {
    return this.uiBridge.createUiContext(sessionId);
  }

  /** Resolve a pending extension UI dialog (from the `ui.respond` RPC). */
  resolveUi(id: string, result: Record<string, unknown>): void {
    this.uiBridge.resolveUi(id, result);
  }

  /** Latest widget state (key → lines + owner session) for frontend re-hydration. */
  getWidgets(): Record<string, { lines: string[]; placement: string; sessionId: string }> {
    return this.uiBridge.getWidgets();
  }

  /** Pending extension dialogs (confirm/select/input) — still awaiting a
   *  response after a page reload. Answered ones live on disk (ui.history). */
  getPendingUiRequests(): Array<{ id: string; request: Record<string, unknown> }> {
    return this.uiBridge.getPendingUiRequests();
  }

  /**
   * Answered extension dialogs, DURABLY persisted per session on disk
   * (`~/.pi/agent/ui-history/<sessionId>.jsonl`, NDJSON append). Survives
   * daemon restarts — the frontend restores read-only cards from here.
   */
  getUiHistory(): Record<string, Array<{ request: Record<string, unknown>; result: Record<string, unknown> }>> {
    return this.uiBridge.getUiHistory();
  }

  /**
   * Starts a pi session in `cwd` (closing any active session first, mirroring
   * pi's one-session-per-process model).
   */
  async createSession(cwd: string): Promise<ActiveSession> {
    return this.startSession({
      cwd,
      sessionManager: this.options.sessionManager ?? SessionManager.create(cwd),
    });
  }

  /**
   * Reopens a historical session file, restoring its full conversation
   * context (pi's SessionManager.open). The session becomes the active one
   * and streams into the bus exactly like a fresh session.
   *
   * If the session is already active (user switched away and back), it is
   * reused as-is — its agent keeps running in the background; recreating it
   * would fork the same file and clash with the live stream.
   */
  async resumeSession(sessionFile: string): Promise<ActiveSession> {
    for (const [sid, session] of this.sessions) {
      if (session.sessionManager?.getSessionFile() === sessionFile) {
        return {
          sessionId: sid,
          cwd: session.sessionManager.getCwd() || this.options.cwd,
          sessionFile: session.sessionManager.getSessionFile(),
        };
      }
    }
    const manager = SessionManager.open(sessionFile);
    const cwd = manager.getCwd() || this.options.cwd;
    return this.startSession({ cwd, sessionManager: manager });
  }

  /**
   * Reads the current conversation path of a session file (root → leaf),
   * serialized for UI display. Does not activate the session.
   *
   * The serialization preserves everything the live stream showed: assistant
   * thinking blocks become `thinking`, tool calls become `toolCalls` (matched
   * to their results via toolCallId), and plain text stays `text` — so a
   * reloaded session renders identically to the live conversation.
   */
  readSessionMessages(sessionFile: string): SessionMessage[] {
    const { entries, persistedDiffs } = this.openSessionForRead(sessionFile);
    return this.buildMessageViews(entries, persistedDiffs);
  }

  /**
   * Lazy-loads a window of a session's messages. Returns the TAIL of the
   * conversation first (the latest `limit` visible messages); scrolling up
   * requests earlier pages via `beforeIndex`. Only the window's entries are
   * turned into views, so opening a huge session no longer pays to parse and
   * render every message.
   */
  readSessionPage(
    sessionFile: string,
    opts: { limit: number; beforeIndex?: number },
  ): { messages: SessionMessage[]; total: number; startIndex: number; hasMore: boolean } {
    const { entries, persistedDiffs } = this.openSessionForRead(sessionFile);

    // A "visible" view excludes toolResult entries (they fold into the tool
    // call that declared them). Count them so we can locate the window in
    // entry-space without building full views for out-of-window content.
    const visibleEntryIdx: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.type === "compaction" || entry.type === "branch_summary") {
        visibleEntryIdx.push(i);
        continue;
      }
      if (entry.type !== "message" || !entry.message) continue;
      const role = String(entry.message.role);
      if (role !== "toolResult") visibleEntryIdx.push(i);
    }
    const total = visibleEntryIdx.length;
    const endVisible = opts.beforeIndex ?? total; // exclusive end in view-space
    const startVisible = Math.max(0, endVisible - opts.limit);
    const startEntry = visibleEntryIdx[startVisible] ?? 0;
    const endEntry = endVisible < total ? (visibleEntryIdx[endVisible] ?? entries.length) : entries.length;
    const messages = this.buildMessageViews(entries.slice(startEntry, endEntry), persistedDiffs);
    return {
      messages,
      total,
      startIndex: startVisible,
      hasMore: startVisible > 0,
    };
  }

  /** Shared session-open plumbing for the read methods above. */
  private openSessionForRead(sessionFile: string): { entries: SessionEntryLike[]; persistedDiffs: Map<string, { result: string; isError: boolean; diff?: string; patch?: string }> } {
    // Multi-session: prefer the in-memory branch of the active session that
    // owns this file — it reflects the live stream, not just what has been
    // flushed to disk (pi writes JSONL at message end, so the file can lag
    // behind the stream when switching back to a running session).
    let manager: SessionManager | undefined;
    for (const [, session] of this.sessions) {
      if (session.sessionManager?.getSessionFile() === sessionFile) {
        manager = session.sessionManager;
        break;
      }
    }
    if (!manager) manager = SessionManager.open(sessionFile);
    const entries = manager.getBranch();

    // Persisted diffs (git-free snapshot store) — the JSONL toolResult entries
    // don't carry details.diff, so refresh/history would lose the red/green
    // view without this fallback.
    const sessionId = manager.getSessionId?.() ?? "";
    const persistedDiffs = sessionId !== "" ? this.loadToolDiffs(sessionId) : new Map();
    return { entries, persistedDiffs };
  }

  /** Turn raw session entries into display views (shared by full + paged reads). */
  private buildMessageViews(entries: SessionEntryLike[], persistedDiffs: Map<string, { result: string; isError: boolean; diff?: string; patch?: string }>): SessionMessage[] {
    // First pass: collect all toolResults by id (they arrive after the
    // assistant message that declared the call).
    const resultsById = new Map<string, { result: string; isError: boolean; diff?: string; patch?: string }>();
    for (const entry of entries) {
      if (entry.type !== "message" || !entry.message) continue;
      const m = entry.message as { role?: unknown; toolCallId?: unknown; isError?: unknown; details?: { diff?: unknown; patch?: unknown } };
      if (String(m.role) === "toolResult" && typeof m.toolCallId === "string") {
        const diff = m.details?.diff;
        const patch = m.details?.patch;
        const persisted = persistedDiffs.get(m.toolCallId);
        resultsById.set(m.toolCallId, {
          result: messageToText(entry.message as HistoryMessageLike),
          isError: m.isError === true,
          ...(typeof diff === "string" && diff.trim() !== "" ? { diff: truncateDisplay(diff, 20_000) } : {}),
          ...(typeof patch === "string" && patch.trim() !== "" ? { patch: truncateDisplay(patch, 40_000) } : {}),
          ...(!diff && persisted?.diff ? { diff: persisted.diff } : {}),
          ...(!patch && persisted?.patch ? { patch: persisted.patch } : {}),
        });
      }
    }

    // Second pass: build views, matching toolResults by id, and compute each
    // turn's total duration (user question → final conclusion) from entry
    // timestamps so reloaded sessions show the same work-block timings.
    const views: SessionMessage[] = [];
    let turnStartTs: number | undefined;
    let turnLastView = -1;
    let turnLastTs = 0;
    const closeTurn = (): void => {
      if (turnStartTs !== undefined && turnLastView >= 0 && turnLastView < views.length) {
        views[turnLastView]!.turnDurationMs = Math.max(0, turnLastTs - turnStartTs);
      }
      turnStartTs = undefined;
      turnLastView = -1;
    };
    for (const entry of entries) {
      // Compaction / branch-summary entries become a visible system note. The
      // summary text itself is NOT shown — the UI only renders a compact
      // "context was summarized" marker (token counts are only available on
      // the live compact call, not from the JSONL).
      if (entry.type === "compaction" || entry.type === "branch_summary") {
        views.push({ role: "system", text: "◌ 前文已摘要" });
        continue;
      }
      if (entry.type !== "message" || !entry.message) continue;
      const role = String(entry.message.role);
      if (role === "toolResult") continue; // already folded into toolCalls

      const entryTs = new Date(entry.timestamp).getTime();
      if (role === "user") closeTurn(); // a new question ends the previous turn

      const parsed = parseContentBlocks(entry.message as HistoryMessageLike);
      const view: SessionMessage = { role, text: parsed.text };
      if (parsed.images.length > 0) view.images = parsed.images;
      if (parsed.thinking) view.thinking = truncateDisplay(parsed.thinking);
      if (parsed.toolCalls.length > 0) {
        view.toolCalls = parsed.toolCalls.map((call) => {
          const matched = resultsById.get(call.id);
          return {
            id: call.id,
            name: call.name,
            args: truncateDisplay(call.args),
            ...(matched
              ? {
                  result: truncateDisplay(matched.result),
                  isError: matched.isError,
                  ...(matched.diff !== undefined ? { diff: matched.diff } : {}),
                  ...(matched.patch !== undefined ? { patch: matched.patch } : {}),
                }
              : {}),
          };
        });
      }
      views.push(view);
      if (role === "user") turnStartTs = entryTs;
      if (!Number.isNaN(entryTs)) {
        turnLastView = views.length - 1;
        turnLastTs = entryTs;
      }
    }
    closeTurn();
    return views;
  }

  /**
   * Lists historical sessions for a cwd from pi's session store (most recent
   * first). Wraps `SessionManager.list`, which reads the JSONL session files
   * on disk — the GUI session tree is backed by real pi history.
   */
  async listHistory(cwd?: string): Promise<SessionHistoryItem[]> {
    try {
      // List across ALL project dirs (the sidebar groups by cwd). The cwd
      // arg is kept for API compat but pi's listAll covers every workspace.
      const infos = await SessionManager.listAll();
      return infos
        .filter((info) => (cwd === undefined ? true : info.cwd === cwd))
        .map((info) => ({
          id: info.id,
          path: info.path,
          name: info.name,
          cwd: info.cwd,
          created: info.created.toISOString(),
          modified: info.modified.toISOString(),
          messageCount: info.messageCount,
          firstMessage: info.firstMessage,
        }));
    } catch {
      // No sessions yet (fresh pi store) — treat as empty history.
      return [];
    }
  }

  /**
   * Aggregates token/cost usage across all persisted sessions (pi JSONL).
   * Each assistant message carries a `usage` record (tokens + cost); this
   * sums them per session and per model. Used by the settings usage panel.
   */
  async getUsageStats(): Promise<UsageStats> {
    return aggregateUsageStats();
  }

  private async startSession(options: { cwd: string; sessionManager: SessionManager }): Promise<ActiveSession> {
    // Multi-session model: do NOT close other sessions here — switching chats
    // must let each session's agent keep running in the background. All
    // sessions are disposed together in close() when the daemon shuts down.

    const modelRuntime = await this.resolveRuntime();
    const factory = this.options.sessionFactory ?? createAgentSession;

    const agentDir = this.options.engineDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

    // When the user has disabled specific global skills or the web GUI ships
    // built-in extensions, build a resource loader that filters skills and/or
    // adds those extensions for THIS session only. Otherwise use pi's default
    // loader (reads settings.json + default discovery paths).
    const disabled = this.options.disabledSkills?.() ?? [];
    const builtinExts = this.options.builtinExtensionPaths ?? [];
    let resourceLoader: DefaultResourceLoader | undefined;
    if (disabled.length > 0 || builtinExts.length > 0) {
      const settingsManager = SettingsManager.create(options.cwd, agentDir);
      const disabledSet = new Set(disabled);
      const loader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir,
        settingsManager,
        // Built-in capabilities load ONLY into web sessions — the shared
        // ~/.pi/agent/settings.json is never modified.
        additionalExtensionPaths: builtinExts.length > 0 ? builtinExts : undefined,
        ...(disabled.length > 0
          ? {
              // Filter user-disabled skills out of the session's system prompt.
              skillsOverride: (result) => ({
                ...result,
                skills: result.skills.filter((skill) => !disabledSet.has(skill.name)),
              }),
            }
          : {}),
      });
      await loader.reload();
      resourceLoader = loader;
    }

    const { session } = await factory({
      cwd: options.cwd,
      agentDir,
      modelRuntime,
      sessionManager: options.sessionManager,
      ...(resourceLoader ? { resourceLoader } : {}),
    });

    // SDK-created sessions never run the interactive/rpc boot path that emits
    // the `session_start` extension event. Extensions like pi-mcp-adapter rely
    // on it to initialize (connect servers, register tools) — without it they
    // stay in "not initialized" forever. bindExtensions emits session_start
    // (all bindings are optional), so call it once per session to give every
    // extension its startup signal.
    try {
      // onError is a real (no-op) binding so `hasBindings` is true —
      // otherwise AgentSession.reload() would skip re-emitting session_start
      // and extensions (pi-mcp-adapter) could never be reloaded on an active
      // session after a config change. uiContext + mode "rpc" lets extensions
      // call ctx.ui.confirm/select/input — bridged to the web GUI.
      await session.bindExtensions({
        onError: () => {},
        uiContext: this.createUiContext(session.sessionId),
        mode: "rpc",
      });
    } catch {
      // Extensions must never break session startup — if a session_start
      // handler throws (e.g. a broken extension), the session still works;
      // that extension simply stays inactive for this session.
    }

    // Ensure the session is on a model with configured credentials. pi picks
    // a built-in default (e.g. openai/gpt-5.5) that the user likely has no
    // key for; switch to the first provider/model the user configured.
    await this.ensureConfiguredModel(session, modelRuntime);

    this.sessions.set(session.sessionId, session);
    this.forwardSessionMessages(session, session.sessionId);
    await this.options.bus.emit("session.created", {
      type: "session.created",
      sessionId: session.sessionId,
      cwd: options.cwd,
    });
    return {
      sessionId: session.sessionId,
      cwd: options.cwd,
      sessionFile: options.sessionManager.getSessionFile(),
    };
  }

  /** Sends a prompt to the given session and records activity in the store. */
  async prompt(sessionId: string, text: string, images?: Array<{ dataUrl: string; mimeType: string }>): Promise<void> {
    const session = this.requireSession(sessionId);
    // Note: models.json is SHARED with the pi CLI — we never auto-restore it
    // from a backup here, or the web GUI would silently clobber config the
    // user changed in the TUI or by hand.
    await session.prompt(text, {
      // pi's provider prefixes data with `data:${mimeType};base64,` itself, so
      // pass the RAW base64 — sending the full data URL would double the prefix
      // and break image requests (e.g. minimax 404s on malformed image data).
      images: images?.map((img) => ({ type: "image" as const, data: img.dataUrl.replace(/^data:[^;]+;base64,/, ""), mimeType: img.mimeType })),
      // When the agent is streaming, steer the current turn: the new message
      // is delivered as soon as the running tool call finishes (automatic
      // guidance — same behavior as the VS Code plugin).
      streamingBehavior: "steer",
    });
  }

  /** Returns the active tool names for a running session. */
  listSessionTools(sessionId: string): string[] {
    const session = this.requireSession(sessionId);
    return session.getActiveToolNames();
  }

  /**
   * Returns the available slash commands for a session: extension commands
   * (pi.registerCommand) + prompt templates. Mirrors pi's own RPC
   * `get_commands` handler (which reads session.extensionRunner / promptTemplates).
   *
   * Skills are merged on the daemon side (listAllSkills). Web-native builtins
   * (compact/new/model/...) are routed by the frontend to engine RPCs, since
   * `session.prompt()` only dispatches extension commands + skill/template
   * expansion — builtin slash commands are TUI-only.
   */
  listCommands(sessionId?: string): { extensions: Array<{ name: string; description?: string }>; templates: Array<{ name: string; description?: string }> } {
    let session: AgentSession | undefined;
    try {
      session = sessionId ? this.requireSession(sessionId) : (this.sessions.values().next().value as AgentSession | undefined);
    } catch {
      session = undefined;
    }
    if (!session) return { extensions: [], templates: [] };
    try {
      // Session internals — same fields pi's RPC server reads for get_commands.
      const internals = session as unknown as {
        extensionRunner?: { getRegisteredCommands(): Array<{ invocationName: string; description?: string }> };
        promptTemplates?: Array<{ name: string; description?: string }>;
      };
      const extensions = (internals.extensionRunner?.getRegisteredCommands() ?? []).map((c) => ({
        name: c.invocationName,
        description: c.description ?? "",
      }));
      const templates = (internals.promptTemplates ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
      }));
      return { extensions, templates };
    } catch {
      return { extensions: [], templates: [] };
    }
  }

  /**
   * Reload a running session's extensions so config changes (e.g. a new MCP
   * server added to mcp.json) take effect without starting a new session.
   * AgentSession.reload() tears down + rebuilds the extension runtime and,
   * because we bound a shutdownHandler, re-emits session_start — which is how
   * pi-mcp-adapter re-reads mcp.json and connects newly-added servers.
   *
   * Reloads every active session when no sessionId is given (MCP servers are
   * global/user-scoped, so all sessions should pick up the change).
   */
  async reloadSession(sessionId?: string): Promise<{ ok: boolean; reloaded: number }> {
    const targets = sessionId ? [this.requireSession(sessionId)] : [...this.sessions.values()];
    let reloaded = 0;
    for (const session of targets) {
      try {
        await session.reload();
        reloaded += 1;
      } catch {
        // reload of one session failing must not block the others
      }
    }
    return { ok: reloaded > 0, reloaded };
  }

  /** The currently active pi session, if any (used by the dispatch tool). */
  getActiveSession(): ActiveSession | undefined {
    const session = this.sessions.values().next().value as AgentSession | undefined;
    if (!session) return undefined;
    return { sessionId: session.sessionId, cwd: this.options.cwd };
  }

  /** Closes the active session (if any) and emits the protocol event. */
  async closeActiveSession(): Promise<void> {
    /* oxlint-disable no-await-in-loop */
    for (const [sessionId, session] of this.sessions) {
      session.dispose();
      this.sessions.delete(sessionId);
      await this.options.bus.emit("session.closed", { type: "session.closed", sessionId });
    }
  }

  async close(): Promise<void> {
    await this.closeActiveSession();
  }

  // ─────── model / credential / session operations (M5 — pi GUI parity) ───────

  /**
   * Lists all available models from the runtime, with provider config loaded
   * from models.json (via VagModelsStore). Used by the GUI's model selector.
   */
  /** Returns the full pi model catalog — every model definition (including
   *  compat, cost, contextWindow, etc.) — so the GUI can auto-fill model
   *  config from the catalog instead of asking the user to hand-write compat.
   */
  async listModelCatalog(): Promise<Array<{
    id: string;
    name?: string;
    provider: string;
    baseUrl: string;
    api: string;
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
    compat?: Record<string, unknown>;
  }>> {
    const runtime = await this.getRuntime();
    const available = await runtime.getAvailable();
    return available.map((m) => ({
      id: String(m.id ?? ""),
      name: m.name !== undefined ? String(m.name) : undefined,
      provider: String(m.provider ?? ""),
      baseUrl: String(m.baseUrl ?? ""),
      api: String(m.api ?? ""),
      reasoning: m.reasoning === true ? true : undefined,
      input: Array.isArray(m.input) ? (m.input as string[]) : undefined,
      contextWindow: typeof m.contextWindow === "number" ? (m.contextWindow as number) : undefined,
      maxTokens: typeof m.maxTokens === "number" ? (m.maxTokens as number) : undefined,
      cost: m.cost && typeof m.cost === "object" ? (m.cost as { input: number; output: number; cacheRead?: number; cacheWrite?: number }) : undefined,
      compat: m.compat && typeof m.compat === "object" ? (m.compat as Record<string, unknown>) : undefined,
    }));
  }

  async listAvailableModels(): Promise<{
    providers: Array<{
      id: string;
      baseUrl: string;
      api: string;
      hasAuth: boolean;
      models: Array<{ id: string; name: string; reasoning: boolean }>;
    }>;
  }> {
    const runtime = await this.getRuntime();
    const available = await runtime.getAvailable();

    // Group by provider id (Model.provider is the provider id)
    const byProvider = new Map<string, { id: string; baseUrl: string; api: string; hasAuth: boolean; models: Array<{ id: string; name: string; reasoning: boolean }> }>();
    for (const model of available) {
      const pid = model.provider;
      let entry = byProvider.get(pid);
      if (!entry) {
        entry = {
          id: pid,
          baseUrl: model.baseUrl ?? "",
          api: model.api ?? "",
          hasAuth: runtime.hasConfiguredAuth(pid),
          models: [],
        };
        byProvider.set(pid, entry);
      }
      entry.models.push({
        id: model.id,
        name: model.name ?? model.id,
        reasoning: model.reasoning ?? false,
      });
    }
    return { providers: [...byProvider.values()] };
  }

  /**
   * Sets a runtime API key for a provider (equivalent to pi's `/login`).
   * Takes effect immediately — no file write, no restart.
   */
  async setRuntimeApiKey(providerId: string, apiKey: string): Promise<void> {
    const runtime = await this.getRuntime();
    await runtime.setRuntimeApiKey(providerId, apiKey);
  }

  /**
   * Removes a runtime API key (equivalent to pi's `/logout`).
   */
  async removeRuntimeApiKey(providerId: string): Promise<void> {
    const runtime = await this.getRuntime();
    await runtime.removeRuntimeApiKey(providerId);
  }

  /**
   * Switches the active session's model (equivalent to pi's `/model`).
   */
  async setActiveModel(sessionId: string, providerId: string, modelId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const runtime = await this.getRuntime();
    const model = runtime.getModel(providerId, modelId);
    if (!model) throw new Error(`model ${providerId}/${modelId} not found`);
    await session.setModel(model);
  }

  /**
   * Sets the thinking level (equivalent to Shift+Tab).
   */
  setThinkingLevel(sessionId: string, level: string): void {
    const session = this.requireSession(sessionId);
    session.setThinkingLevel(level as Parameters<AgentSession["setThinkingLevel"]>[0]);
  }

  /**
   * Cumulative cache waste across a session (pi-compatible algorithm):
   * prompt tokens that appeared in the previous turn's prompt but were NOT
   * read from cache this turn (re-billed at full input rate) — i.e. the
   * extra cost paid vs. a full cache hit.
   *
   * Mirrors pi's `cache-stats` module: per-turn comparison, 1024-token noise
   * floor, compaction/branch_summary resets the baseline.
   */
  private computeCacheStats(session: AgentSession): { missedTokens: number; missedCost: number; missCount: number } | undefined {
    try {
      const entries = session.sessionManager.getBranch();
      let prev: { promptTokens: number; modelKey: string; reportedCache: boolean } | undefined;
      const totals = { missedTokens: 0, missedCost: 0, missCount: 0 };
      for (const entry of entries) {
        if (entry.type === "compaction" || entry.type === "branch_summary") {
          prev = undefined;
          continue;
        }
        if (entry.type !== "message") continue;
        const message = entry.message as {
          role?: string;
          usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { input?: number; cacheRead?: number; cacheWrite?: number } };
          provider?: string;
          model?: string;
        };
        if (message.role !== "assistant") continue;
        const usage = message.usage;
        if (!usage) continue;
        const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
        const modelKey = `${message.provider ?? ""}/${message.model ?? ""}`;
        const reportedCache = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) > 0;
        // First turn, zero prompt, or a zero-cache turn before any cache was reported → not countable.
        if (!prev || promptTokens <= 0 || (!reportedCache && !prev.reportedCache)) {
          prev = { promptTokens, modelKey, reportedCache: (prev?.reportedCache ?? false) || reportedCache };
          continue;
        }
        const missedTokens = Math.min(prev.promptTokens, promptTokens) - (usage.cacheRead ?? 0);
        if (missedTokens > 1024) {
          const paidTokens = (usage.input ?? 0) + (usage.cacheWrite ?? 0);
          const paidCost = usage.cost ? (usage.cost.input ?? 0) + (usage.cost.cacheWrite ?? 0) : 0;
          const paidPerToken = paidTokens > 0 ? paidCost / paidTokens : 0;
          const readPerToken = (usage.cacheRead ?? 0) > 0 && usage.cost
            ? (usage.cost.cacheRead ?? 0) / (usage.cacheRead ?? 1)
            : 0;
          totals.missedTokens += missedTokens;
          totals.missedCost += missedTokens * Math.max(0, paidPerToken - readPerToken);
          totals.missCount += 1;
        }
        prev = { promptTokens, modelKey, reportedCache: prev.reportedCache || reportedCache };
      }
      return totals.missCount > 0 ? totals : undefined;
    } catch {
      return undefined;
    }
  }

  /** Returns the working directory the given session's agent operates in. */
  getSessionCwd(sessionId: string): string {
    const session = this.requireSession(sessionId);
    return session.sessionManager?.getCwd() || this.options.cwd;
  }

  /**
   * Reverts a file to its pre-session state (git-free checkpoint): writes back
   * the first content the engine saw for this file in this session, or deletes
   * the file if it didn't exist before the session's edits.
   */
  async revertFile(sessionId: string, file: string): Promise<{ ok: boolean; error?: string }> {
    const session = this.requireSession(sessionId);
    const cwd = session.sessionManager?.getCwd() || this.options.cwd;
    const resolved = this.resolveBaseline(sessionId, cwd, file);
    if (!resolved) return { ok: false, error: "没有此文件的编辑记录，无法回退" };
    const blocked = this.checkRevert(resolved);
    if (blocked) return blocked;
    return this.executeRevert(resolved);
  }

  /**
   * Reverts a whole turn's files atomically: every file is checked first and
   * if ANY of them was hand-modified (or has no edit record) the whole revert
   * is refused — nothing is written. Only when every file passes does the
   * batch write back. Mirrors the per-turn 撤销 button's contract. */
  async revertFiles(sessionId: string, files: string[]): Promise<{
    ok: boolean;
    results: Array<{ file: string; ok: boolean; error?: string }>;
  }> {
    const session = this.requireSession(sessionId);
    const cwd = session.sessionManager?.getCwd() || this.options.cwd;
    const prepared = files.map((file) => ({ file, resolved: this.resolveBaseline(sessionId, cwd, file) }));
    // Phase 1 — check everything; any block refuses the entire turn revert.
    const results = prepared.map(({ file, resolved }) => {
      if (!resolved) return { file, ok: false, error: "没有此文件的编辑记录，无法回退" };
      const blocked = this.checkRevert(resolved);
      return blocked ? { file, ok: false, error: blocked.error } : { file, ok: true };
    });
    if (results.some((r) => !r.ok)) {
      return { ok: false, results };
    }
    // Phase 2 — all clear, write everything back.
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i]!;
      if (!p.resolved) continue; // unreachable after phase 1
      const done = this.executeRevert(p.resolved);
      if (!done.ok) results[i] = { file: p.file, ok: false, error: done.error };
    }
    return { ok: results.every((r) => r.ok), results };
  }

  /** Looks up a file's baseline (memory → disk) and normalises the path. */
  private resolveBaseline(
    sessionId: string,
    cwd: string,
    file: string,
  ): { abs: string; raw: string; baseline: FileBaseline } | undefined {
    const raw = isAbsolute(file) ? file : join(cwd, file);
    // Normalise the path (resolve) so Map lookups survive / vs \ and casing
    // differences between the args path and the frontend's file string.
    const abs = resolve(raw);
    let perSession = this.fileBaselines.get(sessionId);
    let baseline = perSession?.get(abs) ?? perSession?.get(raw);
    if (!baseline) {
      perSession = this.loadFileBaselines(sessionId);
      baseline = perSession?.get(abs) ?? perSession?.get(raw);
    }
    return baseline ? { abs, raw, baseline } : undefined;
  }

  /** Refuses the revert if the user hand-modified/deleted the file. */
  private checkRevert({ abs, baseline }: { abs: string; baseline: FileBaseline }): { ok: false; error: string } | undefined {
    if (!baseline.exists || typeof baseline.lastContent !== "string") return undefined;
    let current: string | undefined;
    try {
      current = readFileSync(abs, "utf-8");
    } catch {
      current = undefined;
    }
    if (current !== baseline.lastContent) {
      return { ok: false, error: "文件已被手动修改，无法自动回退（请手动还原或先撤销你的修改）" };
    }
    return undefined;
  }

  /** Writes the pre-session snapshot back (or deletes a file that didn't exist). */
  private executeRevert({ abs, baseline }: { abs: string; baseline: FileBaseline }): { ok: boolean; error?: string } {
    try {
      if (baseline.exists) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, baseline.content, "utf-8");
      } else if (existsSync(abs)) {
        rmSync(abs, { force: true });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Returns the active session's info (equivalent to pi's `/session`).
   */
  getSessionInfo(sessionId: string): {
    sessionFile?: string;
    model?: string;
    activeProvider?: string;
    thinkingLevel?: string;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    /** Current context occupancy (not cumulative billing). */
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
    cost: number;
    messageCount: number;
    name?: string;
    /** Cache hit rate of the LATEST assistant message (pi footer semantics). */
    latestCacheHitRate?: number;
    /** Cumulative cache waste (missed re-billed tokens + extra cost). */
    cacheStats?: { missedTokens: number; missedCost: number; missCount: number };
  } {
    const session = this.requireSession(sessionId);
    const stats = session.getSessionStats();
    const cacheStats = this.computeCacheStats(session);
    const contextUsage = session.getContextUsage();
    const latestCacheHitRate = this.latestCacheHitRate(session);
    return {
      sessionFile: stats.sessionFile,
      model: session.model?.id,
      activeProvider: session.model?.provider,
      thinkingLevel: session.thinkingLevel,
      tokens: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        total: stats.tokens.total,
      },
      contextUsage: contextUsage
        ? { tokens: contextUsage.tokens, contextWindow: contextUsage.contextWindow, percent: contextUsage.percent }
        : undefined,
      cost: stats.cost,
      messageCount: stats.totalMessages,
      name: session.sessionName,
      latestCacheHitRate,
      cacheStats,
    };
  }

  /**
   * Cache hit rate of the most recent assistant message — the value pi's
   * footer shows. Per-turn hit rate (not cumulative) is the signal users
   * actually want: it answers "did my last prompt hit the cache?".
   */
  private latestCacheHitRate(session: AgentSession): number | undefined {
    try {
      const entries = session.sessionManager.getBranch();
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry?.type !== "message") continue;
        const message = entry.message as { role?: string; usage?: { input?: number; cacheRead?: number; cacheWrite?: number } };
        if (message.role !== "assistant" || !message.usage) continue;
        const prompt = (message.usage.input ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0);
        if (prompt <= 0) continue;
        return ((message.usage.cacheRead ?? 0) / prompt) * 100;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Sets the session display name (/name).
   */
  async setSessionName(sessionId: string, name: string): Promise<void> {
    const session = this.requireSession(sessionId);
    session.setSessionName(name);
  }

  /**
   * Renames a *historical* session by appending a session_info entry to its
   * JSONL file (works without activating the session).
   */
  async renameSessionFile(sessionFile: string, name: string): Promise<void> {
    // Prefer the active session's in-memory manager — reopening the file here
    // would create a SECOND SessionManager writing the same JSONL while the
    // live agent is appending to it (corruption risk).
    let manager: SessionManager | undefined;
    for (const [, session] of this.sessions) {
      if (session.sessionManager?.getSessionFile() === sessionFile) {
        manager = session.sessionManager;
        break;
      }
    }
    if (!manager) manager = SessionManager.open(sessionFile);
    manager.appendSessionInfo(name);
  }

  /**
   * Deletes a historical session: removes its JSONL file. If it is the
   * active session, it is closed first.
   */
  async deleteSession(sessionFile: string, _sessionId?: string): Promise<void> {
    // Close the active session if it matches this file.
    for (const [sid, session] of this.sessions) {
      const file = session.sessionManager?.getSessionFile();
      if (file === sessionFile) {
        session.dispose();
        this.sessions.delete(sid);
        await this.options.bus.emit("session.closed", { type: "session.closed", sessionId: sid });
      }
    }
    // Remove the file on disk (ignore missing).
    try {
      rmSync(sessionFile, { force: true });
    } catch {
      // non-fatal
    }
    // Clean up this session's durable UI-card history (our PRIVATE directory —
    // never touches pi's own sessions/settings data; keeps lifecycle aligned).
    const sid = _sessionId ?? [...this.sessions].find(([, s]) => s.sessionManager?.getSessionFile() === sessionFile)?.[0];
    if (sid) {
      try {
        rmSync(join(this.agentDirPath(), "ui-history", `${sid}.jsonl`), { force: true });
      } catch {
        // non-fatal
      }
    }
  }

  // ── project-level archive (file-backed) ───────────────────────────────
  //
  // Archiving a project PHYSICALLY moves its whole session directory from
  // `sessions/<encoded-cwd>/` into `archived/<encoded-cwd>/`, so archived
  // sessions disappear from pi's normal scan and only reappear on restore.
  // Permanently deleting happens from the archive only.

  /** pi's agent dir — sessions/ and archived/ live under it. */
  private agentDirPath(): string {
    return this.options.engineDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  }

  /** Directory for persisted session snapshots (git-free checkpoints + diffs). */
  private snapshotsDir(): string {
    return join(this.agentDirPath(), "snapshots");
  }

  private snapshotFile(sessionId: string): string {
    return join(this.snapshotsDir(), `${sessionId}.json`);
  }

  private diffFile(sessionId: string): string {
    return join(this.snapshotsDir(), `${sessionId}.diffs.json`);
  }

  /** Persists a session's file baselines to disk (sync, best-effort). */
  private saveFileBaselines(sessionId: string, baselines: Map<string, FileBaseline>): void {
    try {
      mkdirSync(this.snapshotsDir(), { recursive: true });
      writeFileSync(
        this.snapshotFile(sessionId),
        JSON.stringify({ files: Object.fromEntries(baselines) }),
        "utf-8",
      );
    } catch {
      /* best-effort persistence */
    }
  }

  /** Loads a session's file baselines from disk, or undefined if none. */
  private loadFileBaselines(sessionId: string): Map<string, FileBaseline> | undefined {
    try {
      const raw = readFileSync(this.snapshotFile(sessionId), "utf-8");
      const parsed = JSON.parse(raw) as { files?: Record<string, FileBaseline> };
      if (!parsed.files || typeof parsed.files !== "object") return undefined;
      const out = new Map<string, FileBaseline>();
      for (const [path, v] of Object.entries(parsed.files)) {
        out.set(path, {
          content: v.content,
          exists: v.exists === true,
          ...(typeof v.lastContent === "string" ? { lastContent: v.lastContent } : {}),
        });
      }
      return out;
    } catch {
      return undefined;
    }
  }

  /** Appends a tool's diff/patch to the session's persisted diff log (best-effort).
   *  Append-only JSONL: each entry is one line, so concurrent tool executions
   *  (pi runs tools in parallel) never clobber each other, and each write is
   *  O(1) regardless of log size. Old JSON-array files are still readable. */
  private saveToolDiff(sessionId: string, toolCallId: string, file: string, diff?: string, patch?: string): void {
    if (!diff && !patch) return;
    try {
      mkdirSync(this.snapshotsDir(), { recursive: true });
      appendFileSync(
        this.diffFile(sessionId),
        JSON.stringify({ toolCallId, file, ...(diff !== undefined ? { diff } : {}), ...(patch !== undefined ? { patch } : {}) }) + "\n",
        "utf-8",
      );
    } catch {
      /* best-effort persistence */
    }
  }

  /** Loads a session's persisted diffs (keyed by toolCallId). Accepts both the
   *  current JSONL format and older JSON-array files. */
  private loadToolDiffs(sessionId: string): Map<string, { file: string; diff?: string; patch?: string }> {
    const out = new Map<string, { file: string; diff?: string; patch?: string }>();
    try {
      const raw = readFileSync(this.diffFile(sessionId), "utf-8");
      const trimmed = raw.trim();
      if (trimmed === "") return out;
      // JSONL: parse line by line; legacy JSON array: parse the whole body once.
      const entries: Array<{ toolCallId: string; file: string; diff?: string; patch?: string }> =
        trimmed.startsWith("[") ? (JSON.parse(trimmed) as Array<{ toolCallId: string; file: string; diff?: string; patch?: string }>) :
        trimmed.split("\n").map((line) => JSON.parse(line) as { toolCallId: string; file: string; diff?: string; patch?: string });
      for (const e of entries) {
        if (e.toolCallId) out.set(e.toolCallId, { file: e.file, diff: e.diff, patch: e.patch });
      }
      return out;
    } catch {
      return out;
    }
  }

  /** Encode a cwd into pi's session subdir name (mirrors pi's getDefaultSessionDirPath). */
  private encodeCwd(cwd: string): string {
    return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  }

  /** Close the active session if it belongs to the given cwd. */
  private closeSessionForCwd(cwd: string): void {
    for (const [sid, session] of this.sessions) {
      if (session.sessionManager?.getCwd() === cwd) {
        session.dispose();
        this.sessions.delete(sid);
        void this.options.bus.emit("session.closed", { type: "session.closed", sessionId: sid });
      }
    }
  }

  /**
   * Archives a project: moves its session dir under `sessions/` to
   * `archived/`. The project disappears from the active tree; its sessions
   * remain fully intact on disk and can be restored or opened by path.
   */
  async archiveProject(cwd: string): Promise<void> {
    const agentDir = this.agentDirPath();
    const src = join(agentDir, "sessions", this.encodeCwd(cwd));
    if (!existsSync(src)) return;
    this.closeSessionForCwd(cwd);
    const dst = join(agentDir, "archived", this.encodeCwd(cwd));
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
  }

  /**
   * Archives a single session file into `archived/<cwd>/`. The session
   * leaves the active tree but stays intact and restorable.
   */
  async archiveSession(sessionFile: string): Promise<void> {
    const cwd = this.sessionCwd(sessionFile);
    if (!cwd) return;
    // Close the active session if it matches this file.
    for (const [sid, session] of this.sessions) {
      if (session.sessionManager?.getSessionFile() === sessionFile) {
        session.dispose();
        this.sessions.delete(sid);
        void this.options.bus.emit("session.closed", { type: "session.closed", sessionId: sid });
      }
    }
    const agentDir = this.agentDirPath();
    const dst = join(agentDir, "archived", this.encodeCwd(cwd), basename(sessionFile));
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(sessionFile, dst);
  }

  /** Restores an archived session file back under `sessions/<cwd>/`. */
  async restoreSession(sessionFile: string): Promise<void> {
    const cwd = this.sessionCwd(sessionFile);
    if (!cwd) return;
    const agentDir = this.agentDirPath();
    const dst = join(agentDir, "sessions", this.encodeCwd(cwd), basename(sessionFile));
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(sessionFile, dst);
  }

  /** Permanently deletes an archived session file (JSONL). */
  async deleteArchivedSession(sessionFile: string): Promise<void> {
    rmSync(sessionFile, { force: true });
  }

  /** Reads the cwd of a session file via pi's SessionManager. */
  private sessionCwd(sessionFile: string): string | undefined {
    try {
      return SessionManager.open(sessionFile).getCwd();
    } catch {
      return undefined;
    }
  }

  /** Restores an archived project: moves its session files back under `sessions/`. */
  async restoreProject(cwd: string): Promise<void> {
    const agentDir = this.agentDirPath();
    const src = join(agentDir, "archived", this.encodeCwd(cwd));
    if (!existsSync(src)) return;
    this.closeSessionForCwd(cwd);
    // Merge files back into sessions/<cwd>/ (which may still hold other
    // active sessions — renaming the whole dir would fail when it exists).
    const dst = join(agentDir, "sessions", this.encodeCwd(cwd));
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
      if (!entry.endsWith(".jsonl")) continue;
      const from = join(src, entry);
      try {
        if (statSync(from).isFile()) renameSync(from, join(dst, entry));
      } catch {
        // skip unreadable/locked files
      }
    }
    rmSync(src, { recursive: true, force: true });
  }

  /** Permanently deletes an archived project's session dir (JSONL). */
  async deleteArchivedProject(cwd: string): Promise<void> {
    const agentDir = this.agentDirPath();
    const dir = join(agentDir, "archived", this.encodeCwd(cwd));
    this.closeSessionForCwd(cwd);
    rmSync(dir, { recursive: true, force: true });
  }

  /** Lists archived projects with their sessions (scans the `archived/` dir). */
  async listArchivedProjects(): Promise<Array<{ cwd: string; sessions: SessionHistoryItem[] }>> {
    const agentDir = this.agentDirPath();
    const root = join(agentDir, "archived");
    if (!existsSync(root)) return [];
    const out: Array<{ cwd: string; sessions: SessionHistoryItem[] }> = [];
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
        const infos = await SessionManager.listAll(dir);
        const cwd = infos[0]?.cwd ?? "";
        if (!cwd) continue;
        out.push({
          cwd,
          sessions: infos.map((i) => ({
            id: i.id,
            path: i.path,
            name: i.name,
            cwd: i.cwd,
            created: i.created.toISOString(),
            modified: i.modified.toISOString(),
            messageCount: i.messageCount,
            firstMessage: i.firstMessage,
          })),
        });
      } catch {
        // Skip unreadable archived dirs.
      }
    }
    return out.toSorted((a, b) => Date.parse(b.sessions[0]!.modified) - Date.parse(a.sessions[0]!.modified));
  }

  /**
   * Manually triggers context compaction (/compact). Returns pi's result so
   * the GUI can show the post-compaction token count.
   */
  async compactSession(sessionId: string, customInstructions?: string): Promise<CompactionResult> {
    const session = this.requireSession(sessionId);
    return await session.compact(customInstructions);
  }

  /**
   * Steers a running session (queues a steering message).
   */
  async steerSession(sessionId: string, text: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.steer(text);
  }

  /** Cancels a queued message by removing it from pi's steering queue. */
  async cancelQueuedMessage(sessionId: string, text: string): Promise<{ cancelled: boolean }> {
    const session = this.requireSession(sessionId);
    const msgs = (session as unknown as Record<string, unknown>)['_steeringMessages'] as string[] | undefined;
    if (msgs) {
      const idx = msgs.indexOf(text);
      if (idx !== -1) {
        msgs.splice(idx, 1);
        return { cancelled: true };
      }
    }
    return { cancelled: false };
  }

  /**
   * Queues a follow-up message.
   */
  async followUpSession(sessionId: string, text: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.followUp(text);
  }

  /**
   * Aborts the current session operation.
   */
  async abortSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    await session.abort();
  }

  /** Cancels an in-progress manual/auto compaction. */
  abortCompaction(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.abortCompaction();
  }

  /**
   * Lists every user message in the active branch as a fork point — the GUI
   * shows a small "回退" affordance on each user message (pi's `/tree`).
   */
  listForkPoints(sessionId: string): Array<{ entryId: string; text: string }> {
    const session = this.requireSession(sessionId);
    return session.getUserMessagesForForking();
  }

  /**
   * Navigates the active branch back to a historical node (pi's `/tree`).
   * The conversation path from root to that node becomes the active branch;
   * returns the user prompt text at that point so the GUI can prefill the
   * editor for modification.
   */
  async navigateToTreeNode(
    sessionId: string,
    targetId: string,
    options?: { summarize?: boolean; customInstructions?: string },
  ): Promise<{ editorText?: string; cancelled: boolean }> {
    const session = this.requireSession(sessionId);
    const result = await session.navigateTree(targetId, options);
    return { editorText: result.editorText, cancelled: result.cancelled };
  }

  /**
   * Exports the active branch to JSONL (/export). Returns the output path.
   */
  exportSession(sessionId: string, outputPath?: string): string {
    const session = this.requireSession(sessionId);
    return session.exportToJsonl(outputPath);
  }

  /**
   * Copies the last assistant message text (/copy).
   */
  getLastAssistantText(sessionId: string): string | undefined {
    const session = this.requireSession(sessionId);
    return session.getLastAssistantText();
  }

  /**
   * Returns the session tree as a serializable view (pi's /tree): every
   * entry with its children, plus the ids on the active leaf path so the
   * GUI can highlight the current branch.
   */
  getSessionTree(sessionId: string): {
    nodes: Array<{
      id: string;
      parentId: string | null;
      type: string;
      role?: string;
      text?: string;
      label?: string;
      timestamp: string;
      children: string[];
    }>;
    leafPath: string[];
    leafId: string;
  } {
    const session = this.requireSession(sessionId);
    const tree = session.sessionManager.getTree();

    // Recursively flatten while recording children ids.
    const nodes: Array<{
      id: string;
      parentId: string | null;
      type: string;
      role?: string;
      text?: string;
      label?: string;
      timestamp: string;
      children: string[];
    }> = [];
    const walk = (node: (typeof tree)[number]): void => {
      const entry = node.entry as SessionEntryLike;
      const childrenIds: string[] = [];
      for (const child of node.children) {
        childrenIds.push((child.entry as SessionEntryLike).id);
      }
      nodes.push({
        id: entry.id,
        parentId: entry.parentId,
        type: entry.type,
        role: typeof (entry as { message?: unknown }).message === "object"
          ? String(((entry as { message?: { role?: unknown } }).message as { role?: unknown })?.role ?? "")
          : undefined,
        text: sessionEntryPreview(entry),
        label: node.label,
        timestamp: entry.timestamp,
        children: childrenIds,
      });
      for (const child of node.children) walk(child);
    };
    for (const root of tree) walk(root);

    // Active leaf path: walk parentId from the leaf up.
    const leafId = session.sessionManager.getLeafId() ?? "";
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const leafPath: string[] = [];
    let cursor: string | undefined = leafId;
    while (cursor) {
      leafPath.push(cursor);
      cursor = byId.get(cursor)?.parentId ?? undefined;
    }

    return { nodes, leafPath, leafId };
  }

  /** Resolves the model runtime (lazy, same as createSession). */
  private getRuntime(): Promise<ModelRuntime> {
    return this.resolveRuntime();
  }

  private async forwardSessionMessages(session: AgentSession, sessionId: string): Promise<void> {
    // Session cwd (the project the agent actually works in) — NOT the daemon's
    // cwd, which is where the engine was constructed. Path-carrying tools and
    // working-tree snapshots must resolve against this.
    const sessionCwd = session.sessionManager?.getCwd() || this.options.cwd;
    session.subscribe((event) => {
      // Agent lifecycle — the GUI uses this to track the whole task
      // (start → end, including all sub-rounds of thinking + tools + final
      // conclusion). Pi's turn_start/turn_end fire per sub-round; we ignore
      // them and use the task-level agent_start/agent_end instead.
      if (event.type === "agent_start") {
        this.uiBridge.nextTurn(sessionId);
        void this.options.bus.emit("session.turn", { type: "session.turn", sessionId, kind: "start" });
        return;
      }
      if (event.type === "agent_end") {
        void this.options.bus.emit("session.turn", { type: "session.turn", sessionId, kind: "end" });
        return;
      }
      if (event.type === "turn_start" || event.type === "turn_end") {
        return; // per-sub-round events — ignored
      }
      if (event.type === "tool_execution_start") {
        // Remember the triggering tool call so ctx.ui cards opened by this
        // tool can anchor to it.
        this.uiBridge.noteToolCall(sessionId, event.toolCallId);
        // Capture the file's content before path-carrying tools run, so we can
        // compute a diff for tools that don't surface pi's details.diff (write).
        const path = extractToolPath(event.args, sessionCwd);
        if (path) {
          try {
            this.toolBaselines.set(event.toolCallId, { path, content: readFileSync(path, "utf-8") });
          } catch {
            // New file (write to a path that doesn't exist yet) — baseline as empty.
            this.toolBaselines.set(event.toolCallId, { path, content: "" });
          }
          // Session-level baseline for revert: keep the FIRST content we saw
          // for this file (before the session's first edit), so revert can
          // restore the pre-session state without git. Normalise the path
          // (path.resolve) so Map lookups are robust to / vs \ and casing.
          const normalized = resolve(path);
          const perSession = this.fileBaselines.get(sessionId) ?? new Map<string, FileBaseline>();
          if (!perSession.has(normalized)) {
            try {
              const initial = readFileSync(path, "utf-8");
              perSession.set(normalized, { content: initial, exists: true, lastContent: initial });
            } catch {
              // File didn't exist before the session's edit — revert deletes it.
              perSession.set(normalized, { content: "", exists: false, lastContent: "" });
            }
          }
          this.fileBaselines.set(sessionId, perSession);
          // Persist so revert survives a daemon restart.
          this.saveFileBaselines(sessionId, perSession);
        } else {
          // No path (bash): pi's own tool diffs (details.diff) still surface
          // for edit tools; bash-driven file changes are not tracked, matching
          // Claude Code's checkpoint behavior.
        }
        void this.options.bus.emit("session.tool_call", {
          type: "session.tool_call",
          sessionId,
          toolCallId: event.toolCallId,
          name: event.toolName,
          args: serializeToolArg(event.args),
        });
        return;
      }
      if (event.type === "tool_execution_end") {
        const diff = extractToolDiff(event.result);
        const patch = extractToolPatch(event.result);
        const baseline = this.toolBaselines.get(event.toolCallId);
        this.toolBaselines.delete(event.toolCallId);
        if (baseline && diff === undefined) {
          // Tools without pi's diff (write, and some bash variants): compute one
          // from the pre-tool content we captured.
          try {
            const current = readFileSync(baseline.path, "utf-8");
            const ours = computeToolDiff(baseline.path, baseline.content, current, sessionCwd);
            if (ours.diff) {
              this.saveToolDiff(sessionId, event.toolCallId, baseline.path, ours.diff, ours.patch);
              void this.options.bus.emit("session.tool_result", {
                type: "session.tool_result",
                sessionId,
                toolCallId: event.toolCallId,
                name: event.toolName,
                result: toolResultText(event.result),
                isError: event.isError,
                diff: ours.diff,
                patch: ours.patch,
              });
            }
            return;
          } catch {
            // File missing/read error — fall through to the plain result below.
          }
        }
        if (diff !== undefined || patch !== undefined) {
          const file = baseline?.path ?? "未知文件";
          this.saveToolDiff(sessionId, event.toolCallId, file, diff, patch);
        }
        // Record the content right after the agent's edit so a later revert can
        // detect hand edits (current != lastContent) and refuse to overwrite.
        if (baseline && !event.isError) {
          const perSession = this.fileBaselines.get(sessionId);
          if (perSession) {
            const key = resolve(baseline.path);
            const entry = perSession.get(key) ?? perSession.get(baseline.path);
            if (entry) {
              try {
                entry.lastContent = readFileSync(baseline.path, "utf-8");
              } catch {
                entry.lastContent = "";
              }
              perSession.set(key, entry);
              this.fileBaselines.set(sessionId, perSession);
              this.saveFileBaselines(sessionId, perSession);
            }
          }
        }
        void this.options.bus.emit("session.tool_result", {
          type: "session.tool_result",
          sessionId,
          toolCallId: event.toolCallId,
          name: event.toolName,
          result: toolResultText(event.result),
          isError: event.isError,
          ...(diff !== undefined ? { diff } : {}),
          ...(patch !== undefined ? { patch } : {}),
        });
        return;
      }
      // A user message (steer) was injected into the agent loop — the GUI uses
      // this to move queued input into the chat timeline at the right moment.
      if (event.type === "message_start" && event.message.role === "user") {
        const parsed = parseContentBlocks(event.message as HistoryMessageLike);
        void this.options.bus.emit("session.message", {
          type: "session.message",
          sessionId,
          kind: "user_queued",
          text: parsed.text,
          ...(parsed.images.length > 0 ? { images: parsed.images } : {}),
        });
        return;
      }
      // pi surfaces model/loop failures as an assistant message carrying an
      // `errorMessage` field (no text deltas) — forward it so the GUI shows
      // the real error instead of a silent turn end.
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.errorMessage) {
        void this.options.bus.emit("session.message", {
          type: "session.message",
          sessionId,
          kind: "error",
          text: event.message.errorMessage,
        });
        return;
      }
      // Authoritative steering-queue state — the GUI renders its queued rail
      // from this instead of optimistically inserting messages locally, so a
      // cancel can never race with pi's internal queue.
      if (event.type === "queue_update") {
        void this.options.bus.emit("session.queue_update", {
          type: "session.queue_update",
          sessionId,
          steering: event.steering,
        });
        return;
      }
      if (event.type !== "message_update") return;
      const { assistantMessageEvent } = event;
      if (assistantMessageEvent.type === "thinking_delta") {
        void this.options.bus.emit("session.thinking", {
          type: "session.thinking",
          sessionId,
          kind: "delta",
          text: assistantMessageEvent.delta,
        });
      } else if (assistantMessageEvent.type === "thinking_end") {
        void this.options.bus.emit("session.thinking", {
          type: "session.thinking",
          sessionId,
          kind: "done",
          text: assistantMessageEvent.content,
        });
      } else if (assistantMessageEvent.type === "text_delta") {
        void this.options.bus.emit("session.message", {
          type: "session.message",
          sessionId,
          kind: "text_delta",
          text: assistantMessageEvent.delta,
        });
      } else if (assistantMessageEvent.type === "text_end") {
        void this.options.bus.emit("session.message", {
          type: "session.message",
          sessionId,
          kind: "text_done",
          text: assistantMessageEvent.content,
        });
      }
    });
  }

  /**
   * Ensures the session is on a model with configured credentials.
   *
   * pi picks a built-in default model (e.g. openai/gpt-5.5) when the user
   * has no saved default — that call would hang on missing API keys. If the
   * current model's provider has no auth, switch to the first configured
   * provider/model that does.
   */
  private async ensureConfiguredModel(session: AgentSession, runtime: ModelRuntime): Promise<void> {
    const current = session.model;
    if (current && runtime.hasConfiguredAuth(current.provider)) return;

    const available = await runtime.getAvailable();
    // No models available (test environment) — skip selection.
    if (available.length === 0) return;
    const authModels = available.filter((m) => runtime.hasConfiguredAuth(m.provider));
    // Prefer the user's configured default (settings.json defaultProvider/defaultModel)
    // when it exists and has auth; otherwise pick the first reachable reasoning model.
    const defaults = this.readDefaultModelConfig();
    const defaultMatch = defaults
      ? authModels.find((m) => m.provider === defaults.provider && m.id === defaults.model)
      : undefined;
    if (defaultMatch) {
      try {
        await session.setModel(defaultMatch);
        return;
      } catch {
        // fall through to reachability-based selection
      }
    }

    const candidates = await this.filterReachableProviders(authModels);
    const target = candidates.toSorted(
      (a, b) => Number(b.reasoning ?? false) - Number(a.reasoning ?? false),
    )[0];
    if (!target || (current && current.provider === target.provider && current.id === target.id)) return;

    try {
      await session.setModel(target);
    } catch {
      // Non-fatal: the prompt call will surface a clear error if the model
      // can't be used, and the GUI can switch models explicitly.
    }
  }

  /** Reads defaultProvider/defaultModel from settings.json (if present). */
  private readDefaultModelConfig(): { provider: string; model: string } | undefined {
    try {
      const settingsPath = join(this.options.engineDir ?? join(homedir(), ".pi", "agent"), "settings.json");
      const raw = readFileSync(settingsPath, "utf8");
      const parsed = JSON.parse(raw) as { defaultProvider?: string; defaultModel?: string };
      if (parsed.defaultProvider && parsed.defaultModel) return { provider: parsed.defaultProvider, model: parsed.defaultModel };
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Filters out providers whose base URLs are unreachable (TCP connect check
   * with a 3-second timeout). Providers that fail the check are skipped so
   * the engine doesn't pick a dead endpoint and hang.
   */
  private async filterReachableProviders(
    models: Awaited<ReturnType<ModelRuntime["getAvailable"]>>,
  ): Promise<Awaited<ReturnType<ModelRuntime["getAvailable"]>>> {
    const seen = new Map<string, boolean>();
    const out: Array<(typeof models)[number]> = [];    for (const m of models) {
      const key = `${m.provider}::${m.baseUrl}`;
      if (!seen.has(key)) {
        const reachable = await this.checkReachable(m.baseUrl);
        seen.set(key, reachable);
      }
      if (seen.get(key)) out.push(m);
    }
    return out;
  }

  private async checkReachable(baseUrl: string): Promise<boolean> {
    try {
      const url = new URL(baseUrl);
      const { hostname, port } = url;
      const p = port ? Number(port) : url.protocol === "https:" ? 443 : 80;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      // Use a lightweight HEAD or TCP connect via fetch
      const res = await fetch(`${url.protocol}//${hostname}:${p}/`, {
        method: "HEAD",
        signal: controller.signal,
      }).catch(() => undefined);
      clearTimeout(timer);
      return res !== undefined;
    } catch {
      return false;
    }
  }

  private requireSession(sessionId: string): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`no active session: ${sessionId}`);
    }
    return session;
  }

  /** If models.json was hand-edited since the last UI save, auto-restore it
   *  from the backup so a misconfigured compat doesn't silence every turn.
   *
   *  REMOVED from the prompt path — models.json is shared with the pi CLI
   *  (~/.pi/agent), so auto-restoring would silently overwrite config the
   *  user changed in the TUI. Kept only as a manual recovery helper.
   *
   *  @deprecated manual recovery only */
  private restoreConfigIfChanged(_sessionId: string): void {
    try {
      const dir = this.options.engineDir ?? join(homedir(), ".pi", "agent");
      const file = join(dir, "models.json");
      const bak = join(dir, "models.json.bak");
      if (!existsSync(bak)) return;
      if (readFileSync(file, "utf8") !== readFileSync(bak, "utf8")) {
        copyFileSync(bak, file);
      }
    } catch { /* best-effort */ }
  }

  private async resolveRuntime(): Promise<ModelRuntime> {
    if (this.options.modelRuntime) return this.options.modelRuntime;
    // Created once per process; reuses the user's existing pi auth/models.
    this.runtimePromise ??= ModelRuntime.create();
    return this.runtimePromise;
  }
}
