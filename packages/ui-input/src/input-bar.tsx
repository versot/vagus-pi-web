import { useEffect, useMemo, useRef, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";
import type { ProviderConfigUI } from "@vagus/ui-tokens";
import { commandColor } from "./command-picker.js";
import type { CommandInfo } from "./command-picker.js";

/**
 * Unified input bar (welcome + chat). Layout, bottom row:
 *
 *   [+] [权限] [◉ 上下文进度条 缓存命中率] [模型选择 ▾] [思考级别 ▾] [发送]
 *
 * - "+" opens a menu: 添加附件 / @ 添加上下文 / / 选择命令或能力
 * - 权限 toggle: 完全访问 ⇄ 变更前确认
 * - 上下文: circular progress (no number) + token usage bar + cache hit rate;
 *   hover shows cost + context details
 * - 模型选择: grouped by provider (shinyway / deepseek / b.ai → models)
 * - 思考级别: 轻度 / 中等 / 深度
 */

export interface SessionUsage {
  model?: string;
  activeProvider?: string;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  /** Current context occupancy (null tokens = unknown, e.g. right after compaction). */
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  cost: number;
  /** Cache hit rate of the latest assistant message (pi footer semantics). */
  latestCacheHitRate?: number;
  cacheStats?: { missedTokens: number; missedCost: number; missCount: number };
}

interface InputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** Current session usage (null when no active session). */
  usage: SessionUsage | null;
  /** All configured providers (for the grouped model picker). */
  providers: ProviderConfigUI[];
  /** Switch the active session's model (providerId, modelId). */
  onSwitchModel: (providerId: string, modelId: string) => void;
  /** Set the thinking level (pi enum: minimal/low/medium/high/xhigh/max). */
  onSetThinking: (level: string) => void;
  /** Current thinking level label (default "轻度"). */
  thinkingLevel?: string;  /** Permission mode toggle. */
  permissionMode: "ask" | "auto";
  onTogglePermission: () => void;
  /** Image attachments (base64) to send with the message. */
  attachments?: Array<{ dataUrl: string; mimeType: string; name?: string }>;
  /** Text file attachments — content read from the picked file, wrapped in
   *  `<file>` tags and appended to the prompt (pi-compatible). */
  fileAttachments?: Array<{ name: string; content: string }>;
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  /** Open the "/" command picker. */
  onCommand?: () => void;
  /** All slash commands for the inline "/" autocomplete (builtin+extension+skill+template). */
  commands?: CommandInfo[];
  /** Insert a picked command into the input (called by the inline dropdown). */
  onPickCommand?: (command: string) => void;
  /** Re-fetch the command palette (called when "/" is typed at the start). */
  onRefreshCommands?: () => void;
  /** When this number changes, focus the input (e.g. after switching sessions). */
  focusSignal?: number;
  /** True while the agent is working — shows a stop button instead of send. */
  busy?: boolean;
  /** A ctx.ui dialog (confirm/select/input) is awaiting a response — the send
   *  button becomes a “dialog” button that re-focuses it. */
  hasPendingDialog?: boolean;
  onRestoreDialog?: () => void;
  /** Called when the user clicks the stop button while busy. */
  onStop?: () => void;
  /** Fallback model label shown when usage is null (welcome screen). */
  selectedModel?: string;
  /** User messages queued while the agent is busy (shown as a rail). */
  queuedMessages?: Array<{ id: number; text: string }>;
  /** Cancel a queued message. */
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function InputBar({ value, onChange, onSubmit, usage, providers, onSwitchModel, onSetThinking, thinkingLevel = "off", permissionMode, onTogglePermission, attachments = [], fileAttachments = [], onAttach, onRemoveAttachment, onCommand, commands = [], onPickCommand, onRefreshCommands, focusSignal, busy = false, hasPendingDialog = false, onRestoreDialog, onStop, selectedModel, queuedMessages = [] }: InputBarProps): JSX.Element {
  const t = useTokens();
  const [menuOpen, setMenuOpen] = useState(false);
  // Inline "/" command dropdown state (open + keyboard selection index).
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  /** Queued-rail visibility, delayed 300ms so a message that is enqueued and
   *  immediately consumed (agent idle) never flashes the rail. */
  const [queuedVisible, setQueuedVisible] = useState(false);
  useEffect(() => {
    if (queuedMessages.length === 0) {
      setQueuedVisible(false);
      return;
    }
    const id = window.setTimeout(() => setQueuedVisible(true), 300);
    return () => window.clearTimeout(id);
  }, [queuedMessages.length]);

  // Auto-grow the textarea to fit its content (reset → snap to scrollHeight).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value]);
  const [modelOpen, setModelOpen] = useState(false);
  const [hoverUsage, setHoverUsage] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const addBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<HTMLDivElement | null>(null);

  // Focus the input when the focusSignal changes (session switch, new session…).
  useEffect(() => {
    if (focusSignal && focusSignal > 0) {
      taRef.current?.focus();
    }
  }, [focusSignal]);

  // Close the + menu on outside mousedown / Esc (same pattern as context menus).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || addBtnRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {

      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Close the model dropdown on outside mousedown / Esc (same pattern as
  // the + menu) — clicking anywhere else (chat, sidebar, input) dismisses it.
  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (modelRef.current?.contains(target)) return;
      setModelOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setModelOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [modelOpen]);

  // ---- context usage ---------------------------------------------------
  const activeModelConfig = useMemo(() => {
    for (const p of providers) {
      const matched = p.models.find((cand) => usage?.activeProvider === p.id && cand.id === usage?.model);
      if (matched) return { provider: p, model: matched };
    }
    return undefined;
  }, [providers, usage?.activeProvider, usage?.model]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctxTotal = activeModelConfig?.model.contextWindow ?? 1_000_000;
  const canAttachImages = activeModelConfig?.model.input?.includes("image") ?? true;
  // The ring shows CURRENT context occupancy, not cumulative billing. pi
  // exposes `contextUsage.tokens` for this; when it's null (e.g. right after
  // compaction, before the next response) we show an empty/unknown ring —
  // never the cumulative total, which would look like compaction did nothing.
  const contextTokens = usage?.contextUsage?.tokens ?? null;
  const contextKnown = contextTokens !== null;
  const used = contextTokens ?? 0;
  const pct = Math.min(1, used / ctxTotal);

  // Cache hit rate of the LATEST assistant message (pi footer semantics):
  // "did my last prompt hit the cache?" — not a cumulative ratio.
  const cacheHitRate = usage?.latestCacheHitRate;

  const R = 7; // circular progress radius
  const CIRC = 2 * Math.PI * R;
  const dash = CIRC * (1 - pct);

  const iconBtn: React.CSSProperties = {
    width: 34, height: 34, borderRadius: 10, border: "none", background: "transparent",
    color: t.color.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  };
  const chip: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 5, fontSize: "0.89em", color: t.color.muted,
    padding: "5px 10px", borderRadius: 8, cursor: "pointer", background: "transparent", border: "none",
    fontFamily: "inherit",
  };
  const menuPanel: React.CSSProperties = {
    position: "absolute", bottom: 42, left: 0, zIndex: 50, minWidth: 190, background: t.color.bg,
    border: `1px solid ${t.color.border}`, borderRadius: 12,
    boxShadow: "0 12px 40px rgba(0,0,0,0.14)", padding: 4,
  };

  const submitBtn = (): void => {
    onSubmit();
  };

  // ── inline "/" command autocomplete ────────────────────────────────
  // Active when the input starts with "/" and the dropdown is open. The
  // command name is the first whitespace-separated token (e.g. "/skill:xx arg").
  const commandMode = commandOpen && value.startsWith("/");
  const commandQuery = commandMode ? value.slice(1).split(/\s+/)[0] ?? "" : "";
  const commandMatches = commandMode
    ? commands.filter((c) => c.name.toLowerCase().includes(commandQuery.toLowerCase()))
    : [];
  // Keyboard selection index stays in range as matches change.
  useEffect(() => {
    if (commandIndex >= commandMatches.length) setCommandIndex(Math.max(0, commandMatches.length - 1));
  }, [commandMatches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickInlineCommand = (name: string): void => {
    // Replace the typed "/query" prefix with the picked command + trailing space
    // so the user can immediately type arguments (e.g. `/mcp` → `/mcp `).
    const rest = value.slice(commandQuery.length + 1);
    const next = `/${name} ${rest.replace(/^\s+/, "")}`;
    onChange(next);
    setCommandOpen(false);
    onPickCommand?.(name);
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", position: "relative" }}
      onMouseDown={(e) => {
        // 点击拦截：只有 textarea 和交互控件可以响应点击；点击其余空白区域
        // （padding、间距、flex 填充区）不产生任何效果——保持焦点不动、
        // 不触发任何交互。preventDefault 只阻止默认聚焦行为，不影响
        // 控件的 click 事件，也不影响 textarea 内的文本选择。
        const el = e.target as HTMLElement;
        if (!el.closest("button, input, textarea, select, [contenteditable], [role='button']")) {
          e.preventDefault();
        }
      }}
    >
      {/* queued messages rail (steer queue) — delayed visibility */}
      {queuedVisible && queuedMessages.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78em", fontWeight: 600, letterSpacing: 0.3, color: t.color.muted }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#8b5cf6", display: "inline-block", animation: "vagus-pulse 1.2s ease-in-out infinite", flexShrink: 0 }} />
            排队中 · {queuedMessages.length} 条
          </div>
          {queuedMessages.map((q, idx) => (
            <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px 0 8px", borderRadius: 9, background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.18)", fontSize: "0.86em", color: t.color.fg }}>
              <span style={{ fontSize: "0.7em", fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.12)", width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{idx + 1}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* attachment previews (images + text files) */}
      {(attachments.length > 0 || fileAttachments.length > 0) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={a.dataUrl} alt={a.name ?? ""} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, border: `1px solid ${t.color.border}` }} />
              <button onClick={() => onRemoveAttachment?.(i)} title="移除" style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", border: "none", background: "#E5484D", color: "#fff", fontSize: "0.71em", lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
          ))}
          {fileAttachments.map((f, i) => (
            <span key={f.name} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 8px", borderRadius: 8, background: t.color.surface, border: `1px solid ${t.color.border}`, fontSize: "0.82em", color: t.color.muted }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
              {f.name}
              <button onClick={() => onRemoveAttachment?.(i + attachments.length)} style={{ width: 14, height: 14, borderRadius: "50%", border: "none", background: "transparent", color: t.color.muted, cursor: "pointer", fontSize: "0.79em", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
      )}

      {/* inline "/" command dropdown (autocomplete above the input) */}
      {commandMode && commandMatches.length > 0 && (
        <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 4, right: 4, zIndex: 60, background: t.color.bg, border: `1px solid ${t.color.border}`, borderRadius: 12, boxShadow: "0 16px 48px rgba(0,0,0,0.18)", maxHeight: 300, overflowY: "auto", padding: 4 }}>
          {commandMatches.map((c, i) => (
            <button
              key={`${c.type}:${c.name}`}
              onClick={() => pickInlineCommand(c.name)}
              onMouseEnter={() => setCommandIndex(i)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", height: 34, padding: "0 10px",
                border: "none", borderRadius: 8, cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: "0.88em",
                background: i === commandIndex ? t.color.surface : "transparent", color: t.color.fg,
              }}
            >
              <span style={{ color: commandColor(c.type, t), fontWeight: 600, flexShrink: 0, fontSize: "0.84em" }}>/{c.name}</span>
              <span style={{ color: t.color.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* textarea */}
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          // Close the dropdown when the input no longer starts with "/".
          if (commandOpen && !e.target.value.startsWith("/")) setCommandOpen(false);
        }}
        onKeyDown={(e) => {
          // Tab selects the highlighted command (same as Enter) — preventDefault
          // stops the browser from moving focus out of the textarea.
          if (e.key === "Tab") {
            if (commandMode && commandMatches.length > 0) {
              e.preventDefault();
              const match = commandMatches[commandIndex];
              if (match) pickInlineCommand(match.name);
            }
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            if (commandMode && commandMatches.length > 0) {
              e.preventDefault();
              const match = commandMatches[commandIndex];
              if (match) pickInlineCommand(match.name);
              return;
            }
            e.preventDefault();
            submitBtn();
          }
          if (e.key === "Escape") {
            if (commandMode) { setCommandOpen(false); e.preventDefault(); return; }
            onChange("");
          }
          if (commandMode) {
            if (e.key === "ArrowDown") { e.preventDefault(); setCommandIndex((i) => Math.min(i + 1, commandMatches.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCommandIndex((i) => Math.max(i - 1, 0)); }
          }
          // Typing "/" at the start opens the command dropdown.
          if (e.key === "/" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const ta = e.currentTarget as HTMLTextAreaElement;
            if (ta.selectionStart === 0) {
              setCommandOpen(true);
              onRefreshCommands?.();
            }
          }
        }}
        onPaste={(e) => {
          // Ctrl+V / paste: extract clipboard images into attachments.
          // Text pastes fall through to the browser default.
          const items = e.clipboardData?.items;
          if (!items) return;
          const files: File[] = [];
          for (const item of Array.from(items)) {
            if (item.kind === "file" && item.type.startsWith("image/")) {
              const file = item.getAsFile();
              if (file) files.push(file);
            }
          }
          if (files.length > 0) {
            e.preventDefault();
            onAttach?.(files);
          }
        }}
        rows={1}
        style={{
          width: "100%", minHeight: 34, overflow: "hidden", background: "transparent", border: "none", outline: "none", resize: "none",
          fontFamily: t.font.sans, fontSize: "1.04em", lineHeight: 1.5, color: t.color.fg, padding: "2px 0 6px",
        }}
      />

      {/* bottom row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>

        {/* + menu */}
        <div style={{ position: "relative" }}>
          <button ref={addBtnRef} title="添加上下文" style={iconBtn} onClick={() => { setMenuOpen((o) => !o); setModelOpen(false); }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          {menuOpen && (
            <div ref={menuRef} style={menuPanel} onMouseDown={(e) => e.stopPropagation()}>
              {[
                {
                  icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14"/></svg>,
                  label: "添加附件",
                  // Always available: text-file attachments work on every model;
                  // only image support depends on the active model's input caps.
                  title: canAttachImages ? undefined : "当前模型不支持图片，仅可添加文本文件",
                  action: () => fileRef.current?.click(),
                },
                {
                  icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>,
                  label: "使用 / 选择命令或能力",
                  action: () => onCommand?.(),
                },
              ].map((item) => (
                <button
                  key={item.label}
                  title={item.title}
                  onClick={() => { setMenuOpen(false); item.action(); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", height: 34,
                    padding: "0 10px", border: "none", background: "transparent", borderRadius: 8,
                    fontSize: "0.89em", color: t.color.fg, cursor: "pointer", textAlign: "left",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.surface; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <span style={{ color: t.color.muted, display: "flex" }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {/* hidden file input for image attachments */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onAttach?.(files);
              e.target.value = "";
            }}
          />
        </div>

        {/* permission toggle — hidden until real beforeToolCall interception is implemented */}
        {/*
        <button
          title={permissionMode === "ask" ? "变更前确认（切换为完全访问）" : "完全访问（切换为变更前确认）"}
          onClick={onTogglePermission}
          style={{
            display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px", borderRadius: 9,
            border: `1px solid ${t.color.border}`, background: "transparent", color: permissionMode === "ask" ? "#B7791F" : "#2D8A4E",
            fontSize: "0.86em", cursor: "pointer", flexShrink: 0,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          {permissionMode === "ask" ? "变更前确认" : "完全访问"}
        </button>
        */}

        <div style={{ flex: 1 }} />

        {/* context usage: circle only; hover shows a detail card (hidden when no session) */}
        {usage && (
        <div
          style={{ position: "relative" }}
          onMouseEnter={() => setHoverUsage(true)}
          onMouseLeave={() => setHoverUsage(false)}
        >
          {/* Transparent hover bridge: covers the gap between the circle and
              the floating card so moving the mouse up never leaves the hover
              area and dismisses the card mid-flight. */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 42 }} />
          <div style={{ display: "flex", alignItems: "center", padding: "4px 4px", borderRadius: 9, cursor: "default" }}>
            <svg width={18} height={18} viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
            <circle cx="9" cy="9" r={R} fill="none" stroke={t.color.border} strokeWidth="2.5" />
            <circle
              cx="9" cy="9" r={R} fill="none"
              stroke={pct > 0.9 ? "#E5484D" : pct > 0.7 ? "#B7791F" : t.color.primary}
              strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={`${CIRC} ${CIRC}`} strokeDashoffset={dash}
              transform="rotate(-90 9 9)"
            />
          </svg>
          </div>

          {/* hover detail card */}
          {hoverUsage && (
            <div style={{
              position: "absolute", bottom: 34, right: 0, zIndex: 60, width: 280, background: t.color.bg,
              border: `1px solid ${t.color.border}`, borderRadius: 12, padding: "12px 14px",
              boxShadow: "0 10px 32px rgba(0,0,0,0.14)", fontSize: "0.82em", color: t.color.fg,
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              {/* capacity row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: t.color.muted }}>上下文容量</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {usage
                    ? contextKnown
                      ? `${fmt(used)} / ${fmt(ctxTotal)} (${(pct * 100).toFixed(2)}%)`
                      : "未知 · 待下次响应"
                    : "—"}
                </span>
              </div>
              {/* progress bar */}
              <div style={{ height: 6, borderRadius: 3, background: t.color.border, overflow: "hidden" }}>
                <div style={{ height: "100%", width: contextKnown ? `${pct * 100}%` : "0%", background: pct > 0.9 ? "#E5484D" : pct > 0.7 ? "#B7791F" : t.color.primary, transition: "width 0.3s" }} />
              </div>
              {/* cache hit rate (pi-compatible) */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: t.color.muted }}>缓存命中率</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{cacheHitRate !== undefined ? `${cacheHitRate.toFixed(1)}%` : "—"}</span>
              </div>
            </div>
          )}
        </div>
        )}

        {/* model picker (grouped by provider) */}
        <div ref={modelRef} style={{ position: "relative" }}>
          <button style={chip} onClick={() => { setModelOpen((o) => !o); setMenuOpen(false); }} title="切换模型">
            {usage?.model?.split("/").pop() ?? selectedModel ?? "选择模型"}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {modelOpen && (
            <div style={{ ...menuPanel, left: "auto", right: 0, width: 250, maxHeight: 320, overflowY: "auto" }} onMouseDown={(e) => e.stopPropagation()}>
              {providers.length === 0 && <div style={{ padding: "10px 12px", fontSize: "0.86em", color: t.color.muted }}>暂无已配置模型</div>}
              {providers.map((p) => (
                <div key={p.id}>
                  <div style={{ padding: "8px 10px 4px", fontSize: "0.75em", fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: t.color.muted }}>{p.id}</div>
                  {p.models.map((m) => {
                    const isActive = usage?.activeProvider === p.id && usage?.model === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => { onSwitchModel(p.id, m.id); setModelOpen(false); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%", height: 32,
                          padding: "0 10px", border: "none", background: isActive ? t.color.surface : "transparent",
                          borderRadius: 8, fontSize: "0.89em", color: t.color.fg, cursor: "pointer", textAlign: "left",
                        }}
                        onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = t.color.surface; }}
                        onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        <span style={{ fontSize: "0.79em", color: t.color.muted, flexShrink: 0 }}>◆</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name ?? m.id}</span>
                        {isActive && <span style={{ fontSize: "0.79em", color: t.color.primary }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* thinking toggle — simplified to on/off since multi-level may not be effective */}
        <button
          onClick={() => onSetThinking(thinkingLevel === "off" ? "high" : "off")}
          title={thinkingLevel === "off" ? "开启思考模式" : "关闭思考模式"}
          style={{
            display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px 0 8px",
            borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.88em",
            background: thinkingLevel === "off" ? "transparent" : "rgba(99,102,241,0.10)",
            color: thinkingLevel === "off" ? t.color.muted : "#6366f1",
            fontWeight: thinkingLevel === "off" ? 400 : 600,
            transition: "all 0.15s",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08A2.5 2.5 0 0 0 12 19.5a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 12 4.5z"/>
          </svg>
          {thinkingLevel === "off" ? "思考关闭" : "思考中"}
        </button>

        {/* send / stop / pending-dialog */}
        <button
          onClick={hasPendingDialog ? onRestoreDialog : busy ? onStop : submitBtn}
          title={hasPendingDialog ? "恢复待处理的弹窗" : busy ? "停止" : "发送"}
          style={{
            width: 38, height: 38, borderRadius: "50%", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            background: hasPendingDialog ? t.color.warning : busy ? "#E8833D" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
            color: "#fff",
            boxShadow: hasPendingDialog || busy ? "none" : "0 4px 14px rgba(99,102,241,0.35)",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
        >
          {hasPendingDialog ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ) : busy ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          )}
        </button>
      </div>
    </div>
  );
}
