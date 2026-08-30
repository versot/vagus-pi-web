import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join, normalize, resolve, sep } from "node:path";
import { ConfigStore } from "@vagus/host-config";
import { EventBus, type CoreEventMap } from "@vagus/host-events";
import { VagModelsStore } from "@vagus/host-models";
import { VagusEngine } from "@vagus/host-engine";
import { JsonRpcServer, StdioTransport, WsServerHost } from "@vagus/host-rpc";
import type { DomainEvent } from "@vagus/protocol";
import { PiPackageManager } from "../plugin-manager.js";
import { listAllSkills } from "../skills.js";

/**
 * `pi-web daemon` — the pi Web GUI backend process.
 *
 * Speaks JSON-RPC 2.0 + event-stream over stdin/stdout JSONL (docs/protocol.md)
 * and WebSocket for the GUI. Session creation is lazy: `session.create`
 * instantiates a session backed by the pi SDK. All configuration lives under
 * `~/.pi/agent/` — the same agent dir the pi CLI uses — so the web GUI and
 * the pi TUI share models, auth, settings, packages, skills and sessions.
 */

function defaultStateDir(): string {
  // Daemon bookkeeping (session index + web-only prefs) stays out of pi's
  // scan dirs (extensions/ skills/ prompts/ themes/) but inside ~/.pi/agent.
  return process.env.PI_WEB_STATE_DIR ?? join(piAgentDir(), "state");
}

/** Resolves pi's agent dir: PI_CODING_AGENT_DIR env or the default ~/.pi/agent. */
function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

/**
 * Per-API-format probe request: endpoint URL + auth headers. Shared by
 * `models.test` (connectivity) and `models.probe` (capability detection) so
 * the two never drift on endpoint/header shape.
 */
function probeRequestFor(apiType: string, url: string, apiKey: string | undefined, modelId: string): { endpoint: string; headers: Record<string, string> } | undefined {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Strip a trailing /chat/completions if the baseUrl already carries it —
  // idempotent so callers never double-append.
  const base = url.replace(/\/chat\/completions$/, "");
  let endpoint: string;
  if (apiType === "anthropic-messages") {
    endpoint = base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
    headers["x-api-key"] = String(apiKey ?? "");
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiType === "openai-responses") {
    endpoint = `${base}/responses`;
    headers["Authorization"] = `Bearer ${String(apiKey ?? "")}`;
  } else if (apiType === "google-generative-ai") {
    endpoint = `${base}/v1beta/models/${modelId}:generateContent`;
    headers["x-goog-api-key"] = String(apiKey ?? "");
  } else {
    // openai-completions (default) — and the detailed probe only supports this.
    endpoint = `${base}/chat/completions`;
    headers["Authorization"] = `Bearer ${String(apiKey ?? "")}`;
  }
  return { endpoint, headers };
}

/**
 * Built-in pi extension paths for the web GUI's sessions.
 *
 * These are loaded SESSION-SCOPED via the engine's resource loader
 * (additionalExtensionPaths) — NEVER written into ~/.pi/agent/settings.json.
 *
 * WHY: settings.json is shared with every pi process on the machine (the
 * pi CLI, the pi agent studio VS Code plugin, …). Injecting a dev extension
 * there would make a buggy extension crash those unrelated tools (exit 1).
 * By scoping to web sessions, the GUI gets its built-ins while other pi
 * frontends stay untouched. The production pi-package (@versot/vaguspi) ships
 * the same extensions via its `pi.extensions` manifest instead.
 */
function builtinExtensionPaths(): string[] {
  const out: string[] = [];
  // Where this file lives: dev (monorepo source) or bundled (npx package).
  const here = fileURLToPath(new URL(".", import.meta.url));
  // Bundled layout: {pkg}/dist/bin.js + {pkg}/extensions/*.js
  const bundleRoot = join(here, "..");

  // ── Built-in MCP extension ──
  // Dev: <repo>/packages/mcp-extension/{src,dist}/index.{ts,js}
  // Bundle: <pkg>/extensions/mcp-extension.js
  const mcpDev = join(here, "..", "..", "..", "..", "packages", "mcp-extension");
  const mcpSource = join(mcpDev, "src", "index.ts");
  const mcpDist = join(mcpDev, "dist", "index.js");
  const mcpBundle = join(bundleRoot, "extensions", "mcp-extension.js");
  const mcpPath = existsSync(mcpSource) ? mcpSource : existsSync(mcpDist) ? mcpDist : mcpBundle;
  if (existsSync(mcpPath)) out.push(mcpPath);

  return out;
}

export async function runDaemon(): Promise<number> {
  const stateDir = defaultStateDir();
  mkdirSync(stateDir, { recursive: true });

  const config = new ConfigStore({ dir: stateDir });
  const bus = new EventBus<CoreEventMap>();
  // Engine dir: pi's real agent dir (~/.pi/agent). The pi SDK and the web
  // stores read the *same* models.json/auth.json/settings.json the pi CLI
  // uses — the web GUI is just another frontend for pi, not an isolated twin.
  const engineDir = piAgentDir();
  mkdirSync(engineDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = engineDir;
  const vagModels = new VagModelsStore(engineDir);
  // Built-in pi extensions for web sessions — loaded session-scoped via the
  // engine, never injected into the shared ~/.pi/agent/settings.json.
  const builtinExtensions = builtinExtensionPaths();
  const host = new VagusEngine({
    cwd: process.cwd(),
    bus,
    engineDir,
    // Built-in capabilities (MCP) load only in web sessions.
    builtinExtensionPaths: builtinExtensions,
    // Global skill enable/disable state (persisted in stateDir/config.json).
    disabledSkills: () => {
      const cfg = config.read() as { disabledSkills?: unknown };
      return Array.isArray(cfg.disabledSkills)
        ? (cfg.disabledSkills as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
    },
  });
  // Plugin store: pi's own package manager (npm/git sources, persisted in
  // settings.json `packages` — identical to `pi install`). MCP server configs
  // are written to the engine dir's mcp.json (consumed by the built-in MCP
  // extension that ships with this package).
  const plugins = new PiPackageManager({ engineDir });

  // Shared RPC method registration — used by both the stdio server and every
  // WebSocket connection (the GUI attaches over WS with the same protocol).
  const registerMethods = (srv: JsonRpcServer): void => {
    srv.registerMethod("ping", () => ({ pong: true }));
    // ── extension UI bridge: answer ctx.ui.confirm/select/input from the GUI ──
    // The engine emits `ui.request` events (forwarded to the GUI over WS); the
    // frontend renders the dialog and responds here, which resolves the
    // extension's pending ctx.ui promise.
    srv.registerMethod("ui.respond", (params) => {
      const { id, ...result } = (params ?? {}) as { id?: unknown; confirmed?: unknown; value?: unknown; cancelled?: unknown };
      if (typeof id !== "string" || id.length === 0) throw new Error("ui.respond: id required");
      host.resolveUi(id, result as Record<string, unknown>);
      return { ok: true };
    });
    // Latest widget state — lets a freshly-loaded frontend re-hydrate widgets
    // (setWidget lines) after a page reload without waiting for re-registration.
    srv.registerMethod("ui.widgets", () => host.getWidgets());
    // Pending dialogs — lets a freshly-loaded frontend re-show confirm/select/
    // input dialogs after a page reload (the awaiting extension call is still
    // alive in the daemon; resolving it works as before).
    srv.registerMethod("ui.pending", () => host.getPendingUiRequests());
    // Answered dialog history — DURABLE (disk-backed, ~/.pi/agent/ui-history);
    // restores read-only cards even after a daemon restart.
    srv.registerMethod("ui.history", () => host.getUiHistory());
    // ── usage stats (settings panel) ──
    srv.registerMethod("usage.stats", () => host.getUsageStats());
    srv.registerMethod("session.tools", (params) => {
      const sessionId = requireString((params as { sessionId?: unknown } | undefined)?.sessionId, "sessionId");
      return host.listSessionTools(sessionId);
    });
    srv.registerMethod("session.reload", (params) => {
      const sid = (params as { sessionId?: unknown } | undefined)?.sessionId;
      return host.reloadSession(typeof sid === "string" && sid.length > 0 ? sid : undefined);
    });
    srv.registerMethod("session.history", (params) =>
      host.listHistory((params as { cwd?: unknown } | undefined)?.cwd === undefined ? undefined : requireString((params as { cwd?: unknown }).cwd, "cwd")),
    );
    srv.registerMethod("session.create", (params) => {
      const cwd = (params as { cwd?: unknown } | undefined)?.cwd;
      return host.createSession(cwd === undefined ? process.cwd() : requireString(cwd, "cwd"));
    });

    // Returns the user's home directory (start point for the folder picker).
    srv.registerMethod("project.home", () => {
      return homedir();
    });

    // ── project archive ────────────────────────────────────────────────
    // Archive flow: a project (cwd) is archived first — its session files are
    // physically moved into the daemon's `archived/` dir. Only from there
    // can it be permanently deleted. Restore moves the files back.

    srv.registerMethod("project.archive", (params) => {
      const cwd = requireString((params as { cwd?: unknown } | undefined)?.cwd, "cwd");
      return host.archiveProject(cwd);
    });

    srv.registerMethod("project.unarchive", (params) => {
      const cwd = requireString((params as { cwd?: unknown } | undefined)?.cwd, "cwd");
      return host.restoreProject(cwd);
    });

    srv.registerMethod("project.archived", () => host.listArchivedProjects());

    // Permanently delete an archived project (its archived session dir).
    srv.registerMethod("project.delete", (params) => {
      const cwd = requireString((params as { cwd?: unknown } | undefined)?.cwd, "cwd");
      return host.deleteArchivedProject(cwd);
    });

    // Quick-access roots for the picker: places (Home, Desktop, …) + drives (C:, …).
    srv.registerMethod("project.roots", () => {
      const home = homedir();
      const places: { name: string; path: string; isDirectory: boolean }[] = [
        { name: "Home", path: home, isDirectory: true },
        { name: "Root", path: sep, isDirectory: true },
      ];
      const candidates = ["Desktop", "Downloads", "Documents", "Pictures", "Music", "Videos"];
      for (const name of candidates) {
        const p = join(home, name);
        try { if (statSync(p).isDirectory()) places.push({ name, path: p, isDirectory: true }); } catch { /* skip */ }
      }
      const drives: { name: string; path: string; isDirectory: boolean }[] = [];
      if (process.platform === "win32") {
        for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
          const root = `${letter}:\\`;
          try { if (statSync(root).isDirectory()) drives.push({ name: `${letter}:`, path: root, isDirectory: true }); } catch { /* skip */ }
        }
      }
      return { places, drives };
    });

    // Lists a directory for the in-app folder picker.
    // Supports `~` for home dir. Entries sorted: dirs first, then files, alphabetically.
    srv.registerMethod("project.listDir", (params) => {
      const raw = requireString((params as { dir?: unknown } | undefined)?.dir, "dir");
      const dir = normalize(resolve(raw.replace(/^~(?=$|[\\/])/, homedir())));
      const entries: { name: string; path: string; isDirectory: boolean }[] = [];
      try {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
          if (name.name.startsWith(".")) continue; // hide dotfiles
          if (name.name === "node_modules" || name.name === ".git") continue;
          try {
            const st = statSync(join(dir, name.name));
            entries.push({ name: name.name, path: join(dir, name.name), isDirectory: st.isDirectory() });
          } catch {
            // unreadable entry — skip
          }
        }
      } catch {
        return { path: dir, entries: [] };
      }
      entries.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
      return { path: dir, entries };
    });

    // Lists workspace files (up to 300, depth <= 4, text files only) for the
    // "@" context picker. Returns relative paths.
    srv.registerMethod("project.files", (params) => {
      const raw = requireString((params as { cwd?: unknown } | undefined)?.cwd ?? homedir(), "cwd");
      const dir = normalize(resolve(raw.replace(/^~(?=$|[\\/])/, homedir())));
      const out: string[] = [];
      const EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "mdx", "txt", "css", "scss", "html", "vue", "svelte", "py", "go", "rs", "java", "kt", "swift", "c", "cpp", "h", "hpp", "rb", "php", "sh", "yml", "yaml", "toml", "sql", "graphql", "proto", "xml", "env", "ini", "lock"]);
      const walk = (current: string, depth: number): void => {
        if (out.length >= 300 || depth > 4) return;
        let items: { name: string; isDir: boolean }[] = [];
        try {
          items = readdirSync(current, { withFileTypes: true })
            .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist" && e.name !== "build")
            .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
        } catch { return; }
        items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
        for (const it of items) {
          if (out.length >= 300) return;
          const full = join(current, it.name);
          const rel = full.slice(dir.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
          if (it.isDir) walk(full, depth + 1);
          else {
            const ext = it.name.split(".").pop() ?? "";
            if (EXT.has(ext)) out.push(rel);
          }
        }
      };
      walk(dir, 0);
      return { cwd: dir, files: out.slice(0, 300) };
    });

    // Reads a workspace file's text content (for "@" context attachment).
    srv.registerMethod("project.readFile", (params) => {
      const path = requireString((params as { path?: unknown } | undefined)?.path, "path");
      try {
        return { ok: true, content: readFileSync(path, "utf8") };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    });

    // Lists global skills (SKILL.md in ~/.pi/agent/skills/*/ and
    // ~/.agents/skills/), deduped by name (vagusPI wins). Each entry carries
    // `enabled` (the user's enable/disable preference). The "/" command menu
    // still reads name/description, which these include.
    const readDisabledSkills = (): string[] => {
      const cfg = config.read() as { disabledSkills?: unknown };
      return Array.isArray(cfg.disabledSkills)
        ? (cfg.disabledSkills as unknown[]).filter((s): s is string => typeof s === "string")
        : [];
    };
    const skillsWithEnabled = async () => {
      const disabled = new Set(readDisabledSkills());
      const all = await listAllSkills(process.cwd(), engineDir);
      // Settings panel is global — hide project-scoped skills (they belong
      // to their own project's session view, loaded per-session by pi).
      return all.filter((s) => s.source !== "project").map((s) => ({ ...s, enabled: !disabled.has(s.name) }));
    };
    srv.registerMethod("skills.list", async () => skillsWithEnabled());
    srv.registerMethod("skills.setEnabled", async (params) => {
      const { name, enabled } = (params ?? {}) as { name?: unknown; enabled?: unknown };
      const skillName = requireString(name, "name");
      const isEnabled = enabled === true;
      const allNames = new Set(
        (await listAllSkills(process.cwd(), engineDir)).filter((s) => s.source !== "project").map((s) => s.name),
      );
      const disabled = new Set(readDisabledSkills());
      if (isEnabled) disabled.delete(skillName);
      else disabled.add(skillName);
      const next = [...disabled].filter((n) => allNames.has(n)).toSorted();
      config.update({ disabledSkills: next });
      return skillsWithEnabled();
    });

    // ── slash-command palette (the "/" dropdown) ──
    // Combines every command the web GUI can dispatch:
    //   extensions/templates — from the active pi session (same internals as
    //     pi's RPC `get_commands`); extension commands + templates are executed
    //     by session.prompt() which dispatches/expands them.
    //   skills — /skill:<name> expansion (also handled by session.prompt()).
    //   builtins — web-native session ops routed by the frontend to engine
    //     RPCs (session.prompt() does NOT dispatch pi's builtin slash commands;
    //     those are TUI-only).
    srv.registerMethod("commands.list", async (params) => {
      const sessionId = (params as { sessionId?: unknown } | undefined)?.sessionId;
      const { extensions, templates } = host.listCommands(
        typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined,
      );
      const skills = (await listAllSkills(process.cwd(), engineDir))
        .filter((s) => s.source !== "project")
        // User-disabled skills (settings panel) never appear in the "/" palette.
        .filter((s) => !new Set(readDisabledSkills()).has(s.name));
      return {
        extensions: extensions.map((e) => ({ name: e.name, description: e.description })),
        templates: templates.map((t) => ({ name: t.name, description: t.description })),
        skills: skills.map((s) => ({ name: s.name, description: s.description })),
      };
    });

    // Resumes a historical pi session (full context restored from disk).
    srv.registerMethod("session.open", async (params) => {
      const { sessionFile, limit } = (params ?? {}) as { sessionFile?: unknown; limit?: unknown };
      const file = requireString(sessionFile, "sessionFile");
      const ref = await host.resumeSession(file);
      if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
        // Lazy-load: only build the latest `limit` messages + pagination info.
        const page = host.readSessionPage(file, { limit });
        return { ...ref, ...page };
      }
      const messages = host.readSessionMessages(file);
      return { ...ref, messages, total: messages.length, startIndex: 0, hasMore: false };
    });
    // Lazy-load an earlier page of a session (scroll up in the chat).
    srv.registerMethod("session.page", (params) => {
      const p = (params ?? {}) as { sessionFile?: unknown; limit?: unknown; beforeIndex?: unknown };
      const file = requireString(p.sessionFile, "sessionFile");
      const limit = typeof p.limit === "number" && Number.isFinite(p.limit) && p.limit > 0 ? p.limit : 200;
      return host.readSessionPage(file, {
        limit,
        beforeIndex: typeof p.beforeIndex === "number" ? p.beforeIndex : undefined,
      });
    });
    // Reads the current conversation path of a session file (for display).
    srv.registerMethod("session.messages", (params) => {
      const sessionFile = requireString((params as { sessionFile?: unknown } | undefined)?.sessionFile, "sessionFile");
      return host.readSessionMessages(sessionFile);
    });
    srv.registerMethod("session.prompt", (params) => {
      const { sessionId, text, images } = (params ?? {}) as { sessionId?: unknown; text?: unknown; images?: Array<{ dataUrl: string; mimeType: string }> };
      return host.prompt(requireString(sessionId, "sessionId"), requireString(text, "text"), images);
    });

    // ── model & credential management (pi GUI parity: /model /login /logout) ──
    srv.registerMethod("models.list", () => host.listAvailableModels());
    srv.registerMethod("models.config", () => vagModels.read());
    // Full pi model catalog (incl. compat) so the GUI can auto-fill model
    // config instead of asking the user to hand-write compat fields.
    srv.registerMethod("models.catalog", async () => host.listModelCatalog());
    srv.registerMethod("models.probe", async (params) => {
      const { baseUrl, api, apiKey, model } = (params ?? {}) as { baseUrl?: string; api?: string; apiKey?: string; model?: string };
      const url = (baseUrl ?? "").replace(/\/+$/, "");
      const apiType = String(api ?? "openai-completions");
      const modelId = String(model ?? "");
      if (!url || !modelId) return { ok: false, error: "baseUrl and model are required" };
      // Only openai-completions probing is supported; other API types
      // just return connection-ok without capability details.
      if (apiType !== "openai-completions") {
        // Simple connectivity test for non-OpenAI APIs.
        try {
          const res = await fetch(url.replace(/\/chat\/completions$/, "") + "/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${String(apiKey ?? "")}` },
            body: JSON.stringify({ model: modelId, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
            signal: AbortSignal.timeout(10000),
          });
          return { ok: res.ok, compat: {}, input: ["text"], reasoning: false };
        } catch (e: unknown) {
          return { ok: false, error: String(e) };
        }
      }
      const probe = probeRequestFor("openai-completions", url, apiKey, modelId);
      const endpoint = probe!.endpoint;
      const headers = probe!.headers;
      // 1. Basic request — test connectivity & detect reasoning_content.
      let reasoning = false;
      try {
        const r1 = await fetch(endpoint, {
          method: "POST", headers,
          body: JSON.stringify({ model: modelId, max_tokens: 5, messages: [{ role: "user", content: "ping" }] }),
          signal: AbortSignal.timeout(10000),
        });
        if (!r1.ok) {
          const txt = await r1.text();
          return { ok: false, error: `Base request failed (HTTP ${r1.status}): ${txt.slice(0, 200)}` };
        }
        const d1 = (await r1.json()) as Record<string, unknown>;
        const choice = (d1.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0];
        reasoning = (choice?.message as Record<string, unknown> | undefined)?.reasoning_content !== undefined;
      } catch (e: unknown) {
        return { ok: false, error: String(e) };
      }
      // 2. Developer-role probe.
      let supportsDeveloperRole = true;
      try {
        const r2 = await fetch(endpoint, {
          method: "POST", headers,
          body: JSON.stringify({ model: modelId, max_tokens: 2, messages: [{ role: "developer", content: "ping" }, { role: "user", content: "hi" }] }),
          signal: AbortSignal.timeout(10000),
        });
        if (!r2.ok) supportsDeveloperRole = false;
      } catch { supportsDeveloperRole = false; }
      // 3. Image probe (1×1 red PNG).
      let supportsImage = false;
      const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      try {
        const r3 = await fetch(endpoint, {
          method: "POST", headers,
          body: JSON.stringify({
            model: modelId, max_tokens: 2,
            messages: [{ role: "user", content: [{ type: "text", text: "what" }, { type: "image_url", image_url: { url: `data:image/png;base64,${tinyPng}` } }] }],
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (r3.ok) supportsImage = true;
      } catch { /* image not supported */ }
      // Assemble result.
      const compat: Record<string, unknown> = {};
      if (!supportsDeveloperRole) compat.supportsDeveloperRole = false;
      if (reasoning) {
        compat.thinkingFormat = "deepseek";
        compat.requiresReasoningContentOnAssistantMessages = true;
      }
      const input = supportsImage ? ["text", "image"] : ["text"];
      return { ok: true, compat, input, reasoning };
    });

    srv.registerMethod("models.save", (params) => {
      const providers = (params as { providers?: unknown } | undefined)?.providers;
      if (!Array.isArray(providers)) throw new Error("providers must be an array");
      vagModels.write(providers as Parameters<VagModelsStore["write"]>[0]);
      vagModels.backup();
      return vagModels.read();
    });
    srv.registerMethod("models.test", async (params) => {
      const { baseUrl, api, apiKey, model } = (params ?? {}) as { baseUrl?: unknown; api?: unknown; apiKey?: unknown; model?: unknown };
      const url = String(baseUrl ?? "").replace(/\/+$/, "");
      if (url === "") throw new Error("baseUrl required");
      const apiType = String(api ?? "openai-completions");
      const modelId = String(model ?? "");
      const probe = probeRequestFor(apiType, url, String(apiKey ?? ""), modelId);
      if (!probe) throw new Error(`Unsupported API type: ${apiType}`);
      const { endpoint, headers } = probe;
      // Per-API-format body shape.
      let body: unknown;
      if (apiType === "anthropic-messages") {
        body = { model: modelId, max_tokens: 1, messages: [{ role: "user", content: "ping" }] };
      } else if (apiType === "openai-responses") {
        body = { model: modelId, input: "ping", max_output_tokens: 1 };
      } else if (apiType === "google-generative-ai") {
        body = { contents: [{ role: "user", parts: [{ text: "ping" }] }] };
      } else {
        body = { model: modelId, max_tokens: 1, messages: [{ role: "user", content: "ping" }] };
      }
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        const status = res.status;
        let bodyText = "";
        try { bodyText = await res.text(); } catch { /* non-JSON body */ }
        // Model-level precision: an endpoint that responds means the address
        // and key are fine, but if the error says the *model* is unknown the
        // test must fail for that model specifically.
        const lower = bodyText.toLowerCase();
        const modelMissing =
          /model.{0,60}(not found|does not exist|not support|not available|invalid|not_found)|(does not exist|unknown model|no such model|invalid model|model_not_found|not_found_error)/.test(lower);
        if (status >= 200 && status < 300) return { ok: true, status };
        if (status === 401 || status === 403) return { ok: false, status, reason: "auth" };
        if (modelMissing) return { ok: false, status, reason: "model" };
        // Any other response < 500: reachable + auth accepted, only the probe
        // shape is off — count as connected.
        return { ok: status < 500, status };
      } catch {
        return { ok: false, status: 0 };
      }
    });
    srv.registerMethod("credentials.set", (params) => {
      const { providerId, apiKey } = (params ?? {}) as { providerId?: unknown; apiKey?: unknown };
      return host.setRuntimeApiKey(requireString(providerId, "providerId"), requireString(apiKey, "apiKey"));
    });
    srv.registerMethod("credentials.remove", (params) => {
      const { providerId } = (params ?? {}) as { providerId?: unknown };
      return host.removeRuntimeApiKey(requireString(providerId, "providerId"));
    });

    // ── session ops (pi GUI parity: /model /session /name /compact /queue) ──
    srv.registerMethod("session.model.set", (params) => {
      const { sessionId, providerId, modelId } = (params ?? {}) as { sessionId?: unknown; providerId?: unknown; modelId?: unknown };
      return host.setActiveModel(requireString(sessionId, "sessionId"), requireString(providerId, "providerId"), requireString(modelId, "modelId"));
    });
    srv.registerMethod("session.thinking.set", (params) => {
      const { sessionId, level } = (params ?? {}) as { sessionId?: unknown; level?: unknown };
      host.setThinkingLevel(requireString(sessionId, "sessionId"), requireString(level, "level"));
      return { ok: true };
    });
    srv.registerMethod("session.info", (params) => {
      const { sessionId } = (params ?? {}) as { sessionId?: unknown };
      return host.getSessionInfo(requireString(sessionId, "sessionId"));
    });
    srv.registerMethod("session.rename", (params) => {
      const { sessionId, name } = (params ?? {}) as { sessionId?: unknown; name?: unknown };
      return host.setSessionName(requireString(sessionId, "sessionId"), requireString(name, "name"));
    });

    // Rename a *historical* session (no activation needed) by file path.
    srv.registerMethod("session.renameFile", (params) => {
      const { sessionFile, name } = (params ?? {}) as { sessionFile?: unknown; name?: unknown };
      return host.renameSessionFile(requireString(sessionFile, "sessionFile"), requireString(name, "name"));
    });

    // Delete a historical session (file + index row).
    srv.registerMethod("session.delete", (params) => {
      const { sessionFile, sessionId } = (params ?? {}) as { sessionFile?: unknown; sessionId?: unknown };
      return host.deleteSession(
        requireString(sessionFile, "sessionFile"),
        typeof sessionId === "string" && sessionId.length > 0 ? sessionId : undefined,
      );
    });

    // Archive a session (moves its file into the daemon's archived dir).
    srv.registerMethod("session.archive", (params) => {
      const sessionFile = requireString((params as { sessionFile?: unknown } | undefined)?.sessionFile, "sessionFile");
      return host.archiveSession(sessionFile);
    });

    // Restore an archived session (moves its file back under sessions/).
    srv.registerMethod("session.restore", (params) => {
      const sessionFile = requireString((params as { sessionFile?: unknown } | undefined)?.sessionFile, "sessionFile");
      return host.restoreSession(sessionFile);
    });

    // Permanently delete an archived session file.
    srv.registerMethod("session.deleteArchived", (params) => {
      const sessionFile = requireString((params as { sessionFile?: unknown } | undefined)?.sessionFile, "sessionFile");
      return host.deleteArchivedSession(sessionFile);
    });

    // Pin/unpin a session (persisted in stateDir/config.json under `pins`).
    srv.registerMethod("session.pin", (params) => {
      const { sessionFile, pinned } = (params ?? {}) as { sessionFile?: unknown; pinned?: unknown };
      const file = requireString(sessionFile, "sessionFile");
      const pins = (config.read().pins as string[] | undefined) ?? [];
      const next = pinned === true ? [...new Set([...pins, file])] : pins.filter((p) => p !== file);
      config.update({ pins: next });
      return { pins: next };
    });
    srv.registerMethod("session.pins", () => {
      return (config.read().pins as string[] | undefined) ?? [];
    });
    srv.registerMethod("session.compact", (params) => {
      const { sessionId, customInstructions } = (params ?? {}) as { sessionId?: unknown; customInstructions?: unknown };
      return host.compactSession(
        requireString(sessionId, "sessionId"),
        typeof customInstructions === "string" && customInstructions.length > 0 ? customInstructions : undefined,
      );
    });
    srv.registerMethod("session.steer", (params) => {
      const { sessionId, text } = (params ?? {}) as { sessionId?: unknown; text?: unknown };
      return host.steerSession(requireString(sessionId, "sessionId"), requireString(text, "text"));
    });
    srv.registerMethod("session.followUp", (params) => {
      const { sessionId, text } = (params ?? {}) as { sessionId?: unknown; text?: unknown };
      return host.followUpSession(requireString(sessionId, "sessionId"), requireString(text, "text"));
    });

    // Cancel a message still waiting in the steering queue (by exact text).
    srv.registerMethod("session.cancelQueued", (params) => {
      const { sessionId, text } = (params ?? {}) as { sessionId?: unknown; text?: unknown };
      return host.cancelQueuedMessage(requireString(sessionId, "sessionId"), requireString(text, "text"));
    });
    srv.registerMethod("session.abort", (params) => {
      const { sessionId } = (params ?? {}) as { sessionId?: unknown };
      return host.abortSession(requireString(sessionId, "sessionId"));
    });
    srv.registerMethod("session.abortCompaction", (params) => {
      const { sessionId } = (params ?? {}) as { sessionId?: unknown };
      host.abortCompaction(requireString(sessionId, "sessionId"));
      return { ok: true };
    });

    // ── file-edit revert (session file baseline — git-free checkpoint) ──
    srv.registerMethod("tool.revert", async (params) => {
      const { sessionId, file } = (params ?? {}) as { sessionId?: unknown; file?: unknown };
      const f = requireString(file, "file");
      return await host.revertFile(requireString(sessionId, "sessionId"), f);
    });

    // ── per-turn batch revert (undo whole turn; atomic check-then-write) ──
    srv.registerMethod("tool.revertBatch", async (params) => {
      const { sessionId, files } = (params ?? {}) as { sessionId?: unknown; files?: unknown };
      const sessionIdStr = requireString(sessionId, "sessionId");
      if (!Array.isArray(files)) throw new Error("files must be an array of file paths");
      return await host.revertFiles(sessionIdStr, files.map((f) => requireString(f, "files[]")));
    });

    // ── tree / fork / export (pi GUI parity: /tree /fork /export /copy) ──
    srv.registerMethod("session.forkPoints", (params) => {
      const { sessionId } = (params ?? {}) as { sessionId?: unknown };
      return host.listForkPoints(requireString(sessionId, "sessionId"));
    });
    srv.registerMethod("session.tree", (params) => {
      const { sessionId } = (params ?? {}) as { sessionId?: unknown };
      return host.getSessionTree(requireString(sessionId, "sessionId"));
    });
    srv.registerMethod("session.navigate", (params) => {
      const { sessionId, targetId, summarize, customInstructions } = (params ?? {}) as {
        sessionId?: unknown;
        targetId?: unknown;
        summarize?: unknown;
        customInstructions?: unknown;
      };
      return host.navigateToTreeNode(
        requireString(sessionId, "sessionId"),
        requireString(targetId, "targetId"),
        {
          summarize: summarize === true ? true : undefined,
          customInstructions:
            typeof customInstructions === "string" && customInstructions.length > 0 ? customInstructions : undefined,
        },
      );
    });
    srv.registerMethod("session.export", (params) => {
      const { sessionId, outputPath } = (params ?? {}) as { sessionId?: unknown; outputPath?: unknown };
      return host.exportSession(
        requireString(sessionId, "sessionId"),
        typeof outputPath === "string" && outputPath.length > 0 ? outputPath : undefined,
      );
    });
    srv.registerMethod("session.lastAssistant", (params) => {
      const { sessionId } = (params ?? {}) as { sessionId?: unknown };
      return host.getLastAssistantText(requireString(sessionId, "sessionId"));
    });

    // ── generic daemon config (stateDir/config.json) ──
    srv.registerMethod("config.get", () => config.read());
    srv.registerMethod("config.set", (params) => {
      const patch = (params ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        next[key] = value;
      }
      return config.update(next);
    });

      // ── pi packages (pi install npm:... / git:... — same as the TUI CLI) ──
    // Install/uninstall go through pi's own PackageManager (SDK), which
    // persists to settings.json `packages` — exactly what `pi install` does.
    srv.registerMethod("plugin.list", () => plugins.list());
    srv.registerMethod("plugin.install", async (params) => {
      const source = requireString((params as { source?: unknown } | undefined)?.source, "source");
      const result = await plugins.install(source);
      // Auto-reload active sessions so the agent immediately sees the newly
      // installed package's extensions/tools/skills (no manual /reload needed).
      if (result.ok) void host.reloadSession().catch(() => {});
      return result;
    });
    srv.registerMethod("plugin.uninstall", async (params) => {
      const source = requireString((params as { source?: unknown } | undefined)?.source, "source");
      const result = await plugins.uninstall(source);
      if (result.ok) void host.reloadSession().catch(() => {});
      return result;
    });

    // ── MCP server config (mcp.json, read by the built-in MCP extension) ──
    srv.registerMethod("mcp.list", (params) => {
      const p = (params ?? {}) as { scope?: unknown; cwd?: unknown };
      const scope = p.scope === "project" ? "project" : "user";
      const cwd = typeof p.cwd === "string" ? p.cwd : undefined;
      return plugins.mcpList(scope, cwd);
    });
    srv.registerMethod("mcp.add", (params) => {
      const p = (params ?? {}) as { name?: unknown; config?: unknown; scope?: unknown; cwd?: unknown };
      return plugins.mcpAdd({
        name: requireString(p.name, "name"),
        config: typeof p.config === "object" && p.config !== null ? (p.config as Record<string, unknown>) : {},
        scope: p.scope === "project" ? "project" : "user",
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
      });
    });
    srv.registerMethod("mcp.remove", (params) => {
      const p = (params ?? {}) as { name?: unknown; scope?: unknown; cwd?: unknown };
      return plugins.mcpRemove(
        requireString(p.name, "name"),
        p.scope === "project" ? "project" : "user",
        typeof p.cwd === "string" ? p.cwd : undefined,
      );
    });
    srv.registerMethod("mcp.update", (params) => {
      const p = (params ?? {}) as { name?: unknown; config?: unknown; scope?: unknown; cwd?: unknown };
      return plugins.mcpUpdate({
        name: requireString(p.name, "name"),
        config: typeof p.config === "object" && p.config !== null ? (p.config as Record<string, unknown>) : {},
        scope: p.scope === "project" ? "project" : "user",
        cwd: typeof p.cwd === "string" ? p.cwd : undefined,
      });
    });
  };

  // Wire the stdio server and transport together without circular init.
  let server: JsonRpcServer | undefined;
  const transport = new StdioTransport((frame) => {
    if (server) void server.handleFrame(frame);
  });
  server = new JsonRpcServer({ send: (frame) => transport.send(frame) });
  registerMethods(server);

  // The GUI attaches over a local WebSocket on the same protocol. When
  // VAGUS_GUI_DIR points at a built UI, the daemon serves it over HTTP on
  // the same port (one process, one port — see WsServerHost).
  const wsPort = Number(process.env.VAGUS_WS_PORT ?? "19707");
  const wsHost = new WsServerHost();
  wsHost.listen({
    port: wsPort,
    registerMethods,
    staticDir: process.env.VAGUS_GUI_DIR,
  });

  // Forward engine events to wire: stdio (headless) + WebSocket (GUI).
  bus.subscribeAll((_name, event) => {
    server?.emit(event as DomainEvent);
    wsHost.broadcast(event as DomainEvent);
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      try {
        wsHost.close();
        await host.close();
      } finally {
        transport.close();
        process.exit(0);
      }
    })();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  transport.start();
  process.stderr.write(`pi-web daemon ready (state: ${stateDir})\n`);
  // Run until killed; shutdown is handled by the signal handlers above.
  return new Promise<number>(() => {});
}
