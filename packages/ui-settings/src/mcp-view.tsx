import { useCallback, useEffect, useState } from "react";
import type { useTokens } from "@vagus/ui-tokens";
import { useTheme } from "@vagus/ui-tokens";

/**
 * MCP server manager (settings → MCP 服务器) — BUILT-IN capability.
 *
 * Lists configured MCP servers (from ~/.pi/agent/mcp.json for user scope and
 * <cwd>/.mcp.json for project scope — the files read by the bundled MCP
 * extension that ships with pi-web) and lets the user add servers in two
 * modes: a guided 表单 (form) or raw JSON (paste {"name": {...}} or
 * {"mcpServers": {...}}).
 *
 * MCP is a built-in feature of pi-web: no plugin install gate, no separate
 * pi-mcp-adapter download. The config is shared with the pi CLI, so servers
 * configured here are also available in the pi TUI (and vice versa).
 *
 * Visual language: gradient hero, lifted cards with soft shadows, staggered
 * entrance animation, smooth segment control, focus rings, press feedback.
 * All motion is CSS (keyframes injected once) — no JS animation libs.
 */

export interface McpServerInfo {
  name: string;
  config: Record<string, unknown>;
}

interface McpViewProps {
  /** Thin RPC wrapper around client.request (method, params) → result. */
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  t: ReturnType<typeof useTokens>;
}

// ── one-shot keyframes (injected once; CSS vars carry theme colors) ──────

const MCP_ANIM_CSS = `
@keyframes vagus-fade-up {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes vagus-pop {
  0%   { opacity: 0; transform: scale(0.96); }
  60%  { opacity: 1; transform: scale(1.01); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes vagus-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
@keyframes vagus-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes vagus-spin {
  to { transform: rotate(360deg); }
}
.vagus-mcp-input:focus { border-color: var(--vagus-focus, #4f8cff) !important; box-shadow: 0 0 0 3px var(--vagus-focus-ring, rgba(79,140,255,0.18)) !important; }
.vagus-mcp-btn-press:active { transform: scale(0.96); }
.vagus-mcp-lift { transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease; }
.vagus-mcp-lift:hover { transform: translateY(-1px); }
`;

// ── helpers ──────────────────────────────────────────────────────────────

/** One-line summary of an MCP server config for the list view. */
function summary(cfg: Record<string, unknown>): string {
  if (typeof cfg.command === "string") {
    const argList = Array.isArray(cfg.args) ? cfg.args.join(" ") : "";
    return `${cfg.command}${argList ? " " + argList : ""}`;
  }
  if (typeof cfg.url === "string") return cfg.url;
  return JSON.stringify(cfg).slice(0, 80);
}

/** Determine the connection type label + color from config. */
function detectType(cfg: Record<string, unknown>): { label: string; color: string } {
  if (cfg.type === "http" || typeof cfg.url === "string") return { label: "HTTP", color: "#3fb950" };
  return { label: "STDIO", color: "#4f8cff" };
}

// ── inline SVG icons ─────────────────────────────────────────────────────

function IconPlug(): JSX.Element {
  return (
    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8h12z" />
    </svg>
  );
}

function IconTrash(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function IconPlus(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconArrowLeft(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function IconEdit(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

function IconServer(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" />
    </svg>
  );
}

function IconSparkle(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </svg>
  );
}

/**
 * Tokenize a JSON string into colored spans for the live preview. Key names
 * get the accent color, strings success-green, numbers amber, literals purple
 * and punctuation muted. Returns a flat list of React nodes.
 */
function highlightJson(raw: string): React.ReactNode[] {
  const re =
    /("(?:[^"\\]|\\.)*"(?=\s*:))|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([\]{}[,:])/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) out.push(raw.slice(last, m.index));
    const [tok, key, str, num, lit] = m;
    let color = "#8b90a0";
    if (key) color = "#79c0ff";
    else if (str) color = "#7ee787";
    else if (num) color = "#e3b341";
    else if (lit) color = "#d2a8ff";
    out.push(<span key={i++} style={{ color }}>{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < raw.length) out.push(raw.slice(last));
  return out;
}

// ── component ────────────────────────────────────────────────────────────

export function McpView({ request, t }: McpViewProps): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** Server currently being edited (null = creating a new one). */
  const [editing, setEditing] = useState<McpServerInfo | null>(null);
  const [mode, setMode] = useState<"form" | "json">("form");
  // form state
  const [name, setName] = useState("");
  const [serverType, setServerType] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("30000");
  const [envText, setEnvText] = useState("");
  const [url, setUrl] = useState("");
  // JSON state
  const [jsonText, setJsonText] = useState("");
  // hover / removal feedback
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // live JSON preview copy feedback
  const [copied, setCopied] = useState(false);

  // Adaptive theme-derived values
  const focusColor = t.color.primary;
  const focusRing = isDark ? `${focusColor}33` : `${focusColor}22`;
  const cardShadow = isDark ? "0 1px 2px rgba(0,0,0,0.25), 0 6px 20px rgba(0,0,0,0.18)" : "0 1px 2px rgba(15,23,42,0.04), 0 6px 20px rgba(15,23,42,0.06)";
  const heroGradient = isDark
    ? "radial-gradient(120% 180% at 85% -20%, rgba(79,140,255,0.22), transparent 55%), radial-gradient(100% 160% at 10% -30%, rgba(121,192,255,0.12), transparent 50%)"
    : "radial-gradient(120% 180% at 85% -20%, rgba(37,99,235,0.10), transparent 55%), radial-gradient(100% 160% at 10% -30%, rgba(59,130,246,0.06), transparent 50%)";
  const skeletonGrad = isDark
    ? "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 37%, rgba(255,255,255,0.04) 63%)"
    : "linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.09) 37%, rgba(0,0,0,0.04) 63%)";

  const checkPlugin = useCallback(async () => {
    // MCP is a built-in capability of pi-web — no plugin gate anymore.
    return Promise.resolve(true);
  }, []);

  useEffect(() => {
    void checkPlugin();
  }, [checkPlugin]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await request("mcp.list")) as McpServerInfo[];
      setServers(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveServer = async (): Promise<void> => {
    setError(null);

    if (mode === "json") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        setError("JSON 格式无效");
        return;
      }
      const obj = parsed as Record<string, unknown>;
      const raw = obj.mcpServers ?? obj;
      const entries = Object.entries(raw as Record<string, unknown>);
      if (entries.length === 0) {
        setError("未找到服务器配置");
        return;
      }
      for (const [n, cfg] of entries) {
        const method = editing ? "mcp.update" : "mcp.add";
        const res = (await request(method, {
          name: n,
          config: typeof cfg === "object" && cfg !== null ? cfg : {},
        })) as { ok: boolean; error?: string };
        if (!res.ok) {
          setError(`「${n}」${res.error ?? (editing ? "更新失败" : "添加失败")}`);
          return;
        }
      }
      setJsonText("");
    } else {
      if (!name.trim()) {
        setError("请输入名称");
        return;
      }
      if (serverType === "stdio" && !command.trim()) {
        setError("请输入命令");
        return;
      }
      if (serverType === "http" && !url.trim()) {
        setError("请输入 URL");
        return;
      }
      let env: Record<string, string> | undefined;
      if (envText.trim()) {
        try {
          env = JSON.parse(envText) as Record<string, string>;
        } catch {
          setError("环境变量 JSON 格式无效");
          return;
        }
      }
      const timeout = Number.parseInt(timeoutMs, 10);
      const config: Record<string, unknown> =
        serverType === "stdio"
          ? {
              command: command.trim(),
              args: args
                .split(/\s+/)
                .map((s) => s.trim())
                .filter(Boolean),
              ...(timeout > 0 ? { timeout } : {}),
              ...(env ? { env } : {}),
            }
          : { type: "http", url: url.trim(), ...(timeout > 0 ? { timeout } : {}) };
      const method = editing ? "mcp.update" : "mcp.add";
      const res = (await request(method, { name: name.trim(), config })) as { ok: boolean; error?: string };
      if (!res.ok) {
        setError(res.error ?? (editing ? "更新失败" : "添加失败"));
        return;
      }
      setName("");
      setCommand("");
      setArgs("");
      setUrl("");
      setEnvText("");
    }
    setAdding(false);
    setEditing(null);
    await refresh();
    // Reload session extensions so existing sessions pick up the change.
    void request("session.reload", {});
  };

  /** Prefill the form/JSON editors from an existing server config. */
  const startEdit = (srv: McpServerInfo): void => {
    setEditing(srv);
    setAdding(true);
    setMode("form");
    setError(null);
    setName(srv.name);
    const cfg = srv.config;
    const isHttp = cfg.type === "http" || typeof cfg.url === "string";
    setServerType(isHttp ? "http" : "stdio");
    if (isHttp) {
      setUrl(typeof cfg.url === "string" ? cfg.url : "");
      setCommand("");
      setArgs("");
    } else {
      setCommand(typeof cfg.command === "string" ? cfg.command : "");
      setArgs(Array.isArray(cfg.args) ? (cfg.args as string[]).join(" ") : "");
      setUrl("");
    }
    setTimeoutMs(typeof cfg.timeout === "number" ? String(cfg.timeout) : "30000");
    setEnvText(
      cfg.env && typeof cfg.env === "object" && Object.keys(cfg.env as Record<string, unknown>).length > 0
        ? JSON.stringify(cfg.env, null, 2)
        : "",
    );
    // JSON editor mirrors the existing raw config (single server).
    setJsonText(JSON.stringify({ [srv.name]: cfg }, null, 2));
  };

  /** Close the add/edit view (back button / cancel). */
  const closeEditor = (): void => {
    setAdding(false);
    setEditing(null);
    setError(null);
  };

  const removeServer = async (srv: string): Promise<void> => {
    setRemovingId(srv);
    try {
      const res = (await request("mcp.remove", { name: srv })) as { ok: boolean; error?: string };
      if (!res.ok) {
        setError(res.error ?? "移除失败");
        setRemovingId(null);
        return;
      }
      await refresh();
      // Reload session extensions so existing sessions drop the removed server.
      void request("session.reload", {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失败");
    } finally {
      setRemovingId(null);
    }
  };

  // MCP is a built-in capability of pi-web — the config lives in mcp.json
  // (user) / .mcp.json (project), read by the bundled MCP extension.

  // ── style presets ──────────────────────────────────────────────────────

  /** Build the config object live from the current form state (form mode). */
  const buildLiveConfig = (): Record<string, unknown> | null => {
    if (serverType === "stdio") {
      if (!command.trim()) return null;
      let env: Record<string, string> | undefined;
      if (envText.trim()) {
        try {
          env = JSON.parse(envText) as Record<string, string>;
        } catch {
          return null; // invalid env JSON — preview can't render it
        }
      }
      const timeout = Number.parseInt(timeoutMs, 10);
      return {
        command: command.trim(),
        args: args
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean),
        ...(timeout > 0 ? { timeout } : {}),
        ...(env ? { env } : {}),
      };
    }
    if (!url.trim()) return null;
    const timeout = Number.parseInt(timeoutMs, 10);
    return { type: "http", url: url.trim(), ...(timeout > 0 ? { timeout } : {}) };
  };

  /** Live JSON string for the right-hand preview panel. */
  const liveConfig = buildLiveConfig();
  // In JSON mode the preview mirrors the pasted text (so it stays in sync);
  // in form mode it renders the config generated from the form fields.
  const previewJson =
    mode === "json"
      ? jsonText.trim()
        ? jsonText
        : null
      : liveConfig === null
        ? null
        : JSON.stringify({ [name.trim() || "server-name"]: liveConfig }, null, 2);

  const copyPreview = async (): Promise<void> => {
    if (previewJson === null) return;
    try {
      await navigator.clipboard.writeText(previewJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: isDark ? t.color.bg : "#ffffff",
    border: `1px solid ${t.color.border}`,
    borderRadius: 10,
    padding: "9px 12px",
    fontSize: 13,
    outline: "none",
    color: t.color.fg,
    fontFamily: "inherit",
    boxSizing: "border-box",
    transition: "border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease",
  };

  const monoStyle: React.CSSProperties = {
    ...inputStyle,
    fontFamily: "monospace",
    fontSize: 12,
    minHeight: 160,
    resize: "vertical",
    lineHeight: 1.6,
    background: t.color.bg,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: t.color.fg, marginBottom: 6, display: "block",
    letterSpacing: "0.01em",
  };

  const hintStyle: React.CSSProperties = {
    fontSize: 11, color: t.color.muted, marginTop: 6, lineHeight: 1.5,
  };

  const fieldWrap: React.CSSProperties = { marginBottom: 18 };

  const btnPrimary: React.CSSProperties = {
    borderRadius: 10,
    padding: "9px 18px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 600,
    background: `linear-gradient(180deg, ${t.color.primary}, ${isDark ? "#3d74e0" : "#1d4fd7"})`,
    color: "#fff",
    border: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    boxShadow: isDark ? "0 1px 0 rgba(255,255,255,0.12) inset, 0 2px 8px rgba(79,140,255,0.35)" : "0 1px 0 rgba(255,255,255,0.5) inset, 0 2px 8px rgba(37,99,235,0.28)",
    transition: "filter 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease",
  };

  const btnSecondary: React.CSSProperties = {
    borderRadius: 10,
    padding: "9px 16px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 500,
    background: isDark ? t.color.surface : "#ffffff",
    color: t.color.fg,
    border: `1px solid ${t.color.border}`,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    transition: "background 0.15s ease, border-color 0.15s ease",
  };

  const btnDanger: React.CSSProperties = {
    ...btnSecondary,
    color: t.color.muted,
    border: "none",
    background: "transparent",
    padding: "6px 10px",
    borderRadius: 8,
  };

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ position: "relative" }}>
      {/* One-shot keyframes */}
      <style>{MCP_ANIM_CSS}</style>

      {/* Hero header with soft glow */}
      <div
        style={{
          position: "relative",
          background: heroGradient,
          border: `1px solid ${t.color.border}`,
          borderRadius: 14,
          padding: "22px 24px",
          marginBottom: 24,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: `linear-gradient(135deg, ${t.color.primary}22, ${t.color.accent}11)`,
            border: `1px solid ${t.color.primary}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: t.color.primary,
          }}>
            <IconServer />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 650, color: t.color.fg, letterSpacing: "-0.01em" }}>
              MCP 服务器
            </div>
            <div style={{ fontSize: 12.5, color: t.color.muted, marginTop: 3, lineHeight: 1.5 }}>
              连接 Model Context Protocol 服务器，扩展 AI 助手的能力
            </div>
          </div>
        </div>
      </div>

      {/* Plugin gate — removed: MCP is a built-in capability of pi-web */}

      {loading && (
        <div style={{ fontSize: 13, color: t.color.muted, padding: 40, textAlign: "center" }}>
          <span style={{ display: "inline-block", animation: "vagus-pulse 1.4s ease-in-out infinite" }}>加载 MCP 配置…</span>
        </div>
      )}

      {!loading && (
        <>
          {!adding && (
            <div style={{ animation: "vagus-fade-up 0.35s ease both" }}>
              {/* Error banner */}
              {error && (
                <div style={{
                  fontSize: 13, color: "#e5484d",
                  background: isDark ? "rgba(248,81,73,0.10)" : "rgba(220,38,38,0.06)",
                  border: `1px solid ${isDark ? "rgba(248,81,73,0.25)" : "rgba(220,38,38,0.2)"}`,
                  borderRadius: 10, padding: "9px 14px", marginBottom: 16,
                  display: "flex", alignItems: "center", gap: 9,
                  animation: "vagus-pop 0.25s ease both",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" stroke="#fff" strokeWidth="2" fill="none" /></svg>
                  {error}
                </div>
              )}

              {/* Toolbar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {servers.length > 0 && (
                    <>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.color.success, display: "inline-block", animation: "vagus-pulse 2.5s ease-in-out infinite" }} />
                      <span style={{ fontSize: 13, color: t.color.muted }}>{servers.length} 个服务器已配置</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setAdding(true)}
                  className="vagus-mcp-btn-press"
                  style={btnPrimary}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
                >
                  <IconPlus /> 新建 MCP 服务器
                </button>
              </div>

              {/* Loading skeleton */}
              {loading && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{
                      height: 62, borderRadius: 12,
                      background: skeletonGrad,
                      backgroundSize: "800px 100%",
                      animation: "vagus-shimmer 1.6s linear infinite",
                      border: `1px solid ${t.color.border}`,
                    }} />
                  ))}
                </div>
              )}

              {/* Empty state */}
              {!loading && servers.length === 0 && (
                <div
                  style={{
                    padding: 56, textAlign: "center",
                    border: `1.5px dashed ${t.color.border}`,
                    borderRadius: 16,
                    animation: "vagus-fade-up 0.35s ease both",
                  }}
                >
                  <div style={{ color: t.color.muted, marginBottom: 14, opacity: 0.8 }}>
                    <IconPlug />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: t.color.fg, marginBottom: 6 }}>
                    还没有配置 MCP 服务器
                  </div>
                  <div style={{ fontSize: 12.5, color: t.color.muted, lineHeight: 1.6 }}>
                    添加一台服务器，让 AI 助手获得新的能力
                  </div>
                </div>
              )}

              {/* Server cards */}
              {!loading && servers.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {servers.map((srv, idx) => {
                    const type = detectType(srv.config);
                    const isHovered = hoveredId === srv.name;
                    const isRemoving = removingId === srv.name;
                    return (
                      <div
                        key={srv.name}
                        onMouseEnter={() => setHoveredId(srv.name)}
                        onMouseLeave={() => setHoveredId(null)}
                        className="vagus-mcp-lift"
                        style={{
                          display: "flex", alignItems: "center", gap: 14,
                          background: isHovered
                            ? isDark ? "rgba(255,255,255,0.03)" : "#fbfcfe"
                            : t.color.surface,
                          border: `1px solid ${isHovered ? t.color.primary + "55" : t.color.border}`,
                          borderRadius: 13,
                          padding: "13px 16px",
                          boxShadow: isHovered ? cardShadow : "none",
                          opacity: isRemoving ? 0.45 : 1,
                          transition: "opacity 0.2s ease",
                          animation: `vagus-fade-up 0.35s ease both`,
                          animationDelay: `${Math.min(idx * 45, 200)}ms`,
                        }}
                      >
                        {/* Type badge */}
                        <div style={{
                          width: 44, height: 26, borderRadius: 8,
                          background: `${type.color}1c`,
                          color: type.color,
                          fontSize: 10, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                          letterSpacing: "0.06em",
                          border: `1px solid ${type.color}30`,
                        }}>
                          {type.label}
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: t.color.fg, marginBottom: 3, display: "flex", alignItems: "center", gap: 8 }}>
                            {srv.name}
                            <span style={{
                              width: 6, height: 6, borderRadius: "50%",
                              background: t.color.success,
                              display: "inline-block",
                              animation: isHovered ? "vagus-pulse 1.8s ease-in-out infinite" : "none",
                              opacity: 0.9,
                            }} />
                          </div>
                          <div style={{
                            fontSize: 12, color: t.color.muted,
                            fontFamily: "monospace",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {summary(srv.config)}
                          </div>
                        </div>

                        {/* Actions */}
                        <button
                          onClick={() => startEdit(srv)}
                          className="vagus-mcp-btn-press"
                          style={btnSecondary}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.color.primary; e.currentTarget.style.color = t.color.primary; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.color.border; e.currentTarget.style.color = t.color.fg; }}
                        >
                          <IconEdit /> 编辑
                        </button>
                        <button
                          onClick={() => void removeServer(srv.name)}
                          disabled={isRemoving}
                          className="vagus-mcp-btn-press"
                          style={{ ...btnDanger, opacity: isRemoving ? 0.6 : 1 }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = t.color.error; e.currentTarget.style.background = isDark ? "rgba(248,81,73,0.10)" : "rgba(220,38,38,0.06)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = t.color.muted; e.currentTarget.style.background = "transparent"; }}
                        >
                          {isRemoving ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <span style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${t.color.error}40`, borderTopColor: t.color.error, animation: "vagus-spin 0.7s linear infinite", display: "inline-block" }} />
                              移除中…
                            </span>
                          ) : (
                            <>
                              <IconTrash /> 移除
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Add/edit server view (two-column: form + live preview) ── */}
          {adding && (
            <div style={{ animation: "vagus-fade-up 0.3s ease both" }}>
              {/* Back */}
              <button
                onClick={closeEditor}
                style={{
                  border: "none", background: "none",
                  color: t.color.muted, fontSize: 12.5,
                  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
                  marginBottom: 18, padding: "4px 8px 4px 0",
                  transition: "color 0.15s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = t.color.fg; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = t.color.muted; }}
              >
                <IconArrowLeft /> 返回列表
              </button>

              <div style={{ fontSize: 17, fontWeight: 650, color: t.color.fg, marginBottom: 4, letterSpacing: "-0.01em" }}>
                {editing ? "编辑 MCP 服务器" : "新建 MCP 服务器"}
              </div>
              <div style={{ fontSize: 12.5, color: t.color.muted, marginBottom: 22, lineHeight: 1.5 }}>
                {editing ? `修改「${editing.name}」的配置，保存后自动生效` : "填写配置，实时预览生成的 MCP 配置 JSON"}
              </div>

              {/* Segment control with sliding thumb */}
              <div style={{
                display: "flex", position: "relative",
                background: isDark ? t.color.bg : "#f1f2f4",
                borderRadius: 11, padding: 4, marginBottom: 22,
                border: `1px solid ${t.color.border}`,
              }}>
                <div style={{
                  position: "absolute", top: 4, bottom: 4,
                  left: mode === "form" ? 4 : "calc(50% + 0px)",
                  width: "calc(50% - 8px)",
                  background: isDark ? t.color.surface : "#ffffff",
                  borderRadius: 8,
                  boxShadow: isDark ? "0 1px 0 rgba(255,255,255,0.06) inset, 0 2px 8px rgba(0,0,0,0.25)" : "0 1px 0 rgba(255,255,255,0.8) inset, 0 1px 4px rgba(0,0,0,0.10)",
                  transition: "left 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
                }} />
                {(["form", "json"] as const).map((m) => (
                  <div
                    key={m}
                    onClick={() => setMode(m)}
                    style={{
                      flex: 1, textAlign: "center" as const, padding: "8px 0",
                      fontSize: 13, cursor: "pointer", position: "relative", zIndex: 1,
                      color: mode === m ? t.color.fg : t.color.muted,
                      fontWeight: mode === m ? 600 : 400,
                      transition: "color 0.2s ease",
                    }}
                  >
                    {m === "form" ? "表单" : "JSON"}
                  </div>
                ))}
              </div>

              {/* Error banner */}
              {error && (
                <div style={{
                  fontSize: 13, color: "#e5484d",
                  background: isDark ? "rgba(248,81,73,0.10)" : "rgba(220,38,38,0.06)",
                  border: `1px solid ${isDark ? "rgba(248,81,73,0.25)" : "rgba(220,38,38,0.2)"}`,
                  borderRadius: 10, padding: "9px 14px", marginBottom: 16,
                  display: "flex", alignItems: "center", gap: 9,
                  animation: "vagus-pop 0.25s ease both",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" stroke="#fff" strokeWidth="2" fill="none" /></svg>
                  {error}
                </div>
              )}

              {/* Two-column layout: form + live preview. The form column keeps
                  a stable min-height so the sticky right preview never jumps
                  when toggling 表单/JSON. */}
              <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
                {/* Left: form */}
                <div style={{ flex: 1, minWidth: 0, minHeight: 400 }}>
                  {mode === "form" && (
                    <div style={{
                      background: t.color.bg,
                      border: `1px solid ${t.color.border}`,
                      borderRadius: 16, padding: "22px 24px",
                      boxShadow: cardShadow,
                    }}>
                      {/* 名称 */}
                      <div style={{ ...fieldWrap }}>
                        <label style={labelStyle}>名称</label>
                        <input
                          className="vagus-mcp-input"
                          style={inputStyle}
                          placeholder="my-mcp-server"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>

                      {/* 连接方式 */}
                      <div style={{ ...fieldWrap, marginBottom: 20 }}>
                        <label style={labelStyle}>连接方式</label>
                        <div style={{ display: "flex", gap: 10 }}>
                          {(["stdio", "http"] as const).map((opt) => {
                            const active = serverType === opt;
                            return (
                              <button
                                key={opt}
                                onClick={() => setServerType(opt)}
                                className="vagus-mcp-btn-press"
                                style={{
                                  flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, cursor: "pointer",
                                  background: active
                                    ? `linear-gradient(180deg, ${t.color.primary}, ${isDark ? "#3d74e0" : "#1d4fd7"})`
                                    : isDark ? t.color.bg : "#ffffff",
                                  color: active ? "#fff" : t.color.fg,
                                  border: active ? "none" : `1px solid ${t.color.border}`,
                                  fontWeight: active ? 600 : 400,
                                  boxShadow: active ? (isDark ? "0 2px 10px rgba(79,140,255,0.30)" : "0 2px 10px rgba(37,99,235,0.22)") : "none",
                                  transition: "all 0.18s ease",
                                }}
                              >
                                {opt === "stdio" ? "stdio（本地命令）" : "http（远程）"}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 分隔线 */}
                      <div style={{ height: 1, background: t.color.border, margin: "2px 0 20px", opacity: 0.7 }} />

                      {/* 连接参数 */}
                      {serverType === "stdio" ? (
                        <>
                          <div style={{ ...fieldWrap }}>
                            <label style={labelStyle}>命令</label>
                            <input
                              className="vagus-mcp-input"
                              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12.5 }}
                              placeholder="npx"
                              value={command}
                              onChange={(e) => setCommand(e.target.value)}
                            />
                          </div>
                          <div style={{ ...fieldWrap }}>
                            <label style={labelStyle}>参数</label>
                            <input
                              className="vagus-mcp-input"
                              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12.5 }}
                              placeholder="-y @modelcontextprotocol/server-memory"
                              value={args}
                              onChange={(e) => setArgs(e.target.value)}
                            />
                            <div style={hintStyle}>多个参数用空格分隔</div>
                          </div>
                        </>
                      ) : (
                        <div style={{ ...fieldWrap }}>
                          <label style={labelStyle}>URL</label>
                          <input
                            className="vagus-mcp-input"
                            style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12.5 }}
                            placeholder="https://mcp.example.com"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                          />
                        </div>
                      )}

                      {/* 分隔线 */}
                      <div style={{ height: 1, background: t.color.border, margin: "2px 0 20px", opacity: 0.7 }} />

                      {/* 高级选项 */}
                      <div style={{ ...fieldWrap }}>
                        <label style={labelStyle}>超时时间（毫秒）</label>
                        <input
                          className="vagus-mcp-input"
                          style={{ ...inputStyle, maxWidth: 220 }}
                          placeholder="30000"
                          value={timeoutMs}
                          onChange={(e) => setTimeoutMs(e.target.value)}
                        />
                        <div style={hintStyle}>默认 30000 ms（30 秒），设为 0 表示不限制</div>
                      </div>

                      {serverType === "stdio" && (
                        <div style={{ ...fieldWrap, marginBottom: 0 }}>
                          <label style={labelStyle}>环境变量（可选）</label>
                          <textarea
                            className="vagus-mcp-input"
                            style={{ ...monoStyle, minHeight: 100 }}
                            placeholder={JSON.stringify({ MY_API_KEY: "your-key" }, null, 2)}
                            value={envText}
                            onChange={(e) => setEnvText(e.target.value)}
                          />
                          <div style={hintStyle}>JSON 格式，留空则不设置</div>
                        </div>
                      )}
                    </div>
                  )}

                  {mode === "json" && (
                    <div style={{
                      background: t.color.bg,
                      border: `1px solid ${t.color.border}`,
                      borderRadius: 16, padding: "22px 24px",
                      boxShadow: cardShadow,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                        <IconSparkle />
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: t.color.fg, letterSpacing: "0.02em" }}>
                          完整配置
                        </span>
                      </div>
                      <div style={{ ...fieldWrap, marginBottom: 0 }}>
                        <textarea
                          className="vagus-mcp-input"
                          style={{ ...monoStyle, minHeight: 200 }}
                          placeholder={JSON.stringify({ "my-mcp-server": { type: "http", url: "" } }, null, 2)}
                          value={jsonText}
                          onChange={(e) => setJsonText(e.target.value)}
                        />
                        <div style={hintStyle}>
                          支持 {"{"}"server-name": {"{...}"}{"}"} 或 {"{"}"mcpServers": {"{"}"server-name": {"{...}"}{"}"}{"}"}，可一次添加多台
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: live JSON preview */}
                <div style={{ width: 340, flexShrink: 0, position: "sticky", top: 0 }}>
                  <div style={{
                    background: t.color.bg,
                    border: `1px solid ${t.color.border}`,
                    borderRadius: 16, padding: "16px 18px",
                    boxShadow: cardShadow,
                  }}>
                    {/* Preview header */}
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      marginBottom: 12,
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: t.color.muted,
                        letterSpacing: "0.06em", textTransform: "uppercase",
                      }}>
                        预生成配置
                      </span>
                      <button
                        onClick={() => void copyPreview()}
                        style={{
                          border: `1px solid ${t.color.border}`,
                          background: "transparent",
                          borderRadius: 6, padding: "3px 8px",
                          fontSize: 10.5, color: t.color.muted, cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.color.primary; e.currentTarget.style.color = t.color.primary; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.color.border; e.currentTarget.style.color = t.color.muted; }}
                      >
                        {copied ? "✓ 已复制" : "复制"}
                      </button>
                    </div>

                    {/* JSON content area — content expands fully, NO internal
                        scrollbar (a scrollbar appearing/disappearing is what
                        caused the jitter). Long configs just make the page
                        taller and scroll with the rest of the settings. */}
                    <div
                      style={{
                        fontFamily: "monospace", fontSize: 12, lineHeight: 1.6,
                        whiteSpace: "pre",
                        background: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.02)",
                        borderRadius: 8, padding: "10px 12px",
                        boxSizing: "border-box",
                        overflow: "visible",
                      }}
                    >
                      {previewJson === null ? (
                        <span style={{ color: t.color.muted, opacity: 0.5 }}>
                          {"{\n  \"server-name\": {\n  }\n"}
                          <span style={{ animation: "vagus-pulse 1.4s ease-in-out infinite" }}>
                            {mode === "json" ? "  // 在此粘贴或输入 MCP 配置 JSON" : "  // 填写左侧表单自动生成"}
                          </span>
                          {"\n}"}
                        </span>
                      ) : (
                        <>
                          {highlightJson(previewJson)}
                          <div style={{ height: 4 }} />
                          <div style={{ fontSize: 10.5, color: t.color.muted, opacity: 0.5, whiteSpace: "nowrap" }}>
                            {JSON.stringify(previewJson).length} B
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button
                  onClick={() => void saveServer()}
                  className="vagus-mcp-btn-press"
                  style={btnPrimary}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
                >
                  <IconPlus /> {editing ? "保存" : "添加"}
                </button>
                <button
                  onClick={closeEditor}
                  className="vagus-mcp-btn-press"
                  style={btnSecondary}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Theme-derived CSS vars for focus ring */}
      <style>{`
        :root { --vagus-focus: ${focusColor}; --vagus-focus-ring: ${focusRing}; }
      `}</style>
    </div>
  );
}