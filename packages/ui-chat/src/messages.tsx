import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTheme, useTokens } from "@vagus/ui-tokens";
import type { ChatItem } from "./chat.js";
import { Markdown } from "./markdown.js";
import { CompactionNote } from "./compaction-note.js";
import { collectEdits } from "./file-edits.js";

/**
 * Parse a `<skill name="...">...</skill>` block and render it as a collapsed
 * tag (click to expand). The FULL content is still sent to the agent — only
 * the DISPLAY is compressed so the user bubble stays clean.
 */
const SKILL_RE = /<skill\s+name="([^"]+)"[^>]*>\s*(?:References are relative to[^\n]*\n\n)?([\s\S]*?)<\/skill>/g;

type TextPart = { type: "text"; text: string } | { type: "skill"; name: string };

function SkillBlockParts({ parts }: { parts: TextPart[] }): JSX.Element {
  const t = useTokens();
  return (
    <>
      {parts.map((p, i) =>
        p.type === "skill" ? (
          <span key={i} title={`skill: ${p.name}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 6, fontSize: "0.85em", background: "rgba(210,153,34,0.10)", border: "1px solid rgba(210,153,34,0.30)", color: t.color.warning, fontFamily: t.font.mono }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V5.5a.5.5 0 0 0-.5-.5H6.5A2.5 2.5 0 0 0 4 7.5v12z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/><path d="M12 6.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/></svg>
            {p.name}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

/**
 * Reverse a skill expansion for copy/edit: turn `<skill name="x">…</skill>`
 * back into `/skill:x` so copying a user message gives the original command,
 * not the full injected prompt.
 */
function restoreSkillCommands(text: string): string {
  return text.replace(/<skill\s+name="([^"]+)"[^>]*>[\s\S]*?<\/skill>/g, (_m, name: string) => `/skill:${name}`);
}

/**
 * Unify a user message into { skillTag, args, copyText }:
 * - realtime form: item.skillTag set, text = original `/skill:x args`
 * - history form: text = expanded `<skill name="x">…</skill>\n\nargs`
 * (history stores ONLY the expanded content, so the command is rebuilt).
 */
function parseSkillMessage(item: { skillTag?: string; text: string }): { skillTag?: string; args: string; copyText: string } {
  const text = item.text ?? "";
  if (item.skillTag) {
    const args = text.replace(/^\/skill:[^\s]*\s*/, "");
    return { skillTag: item.skillTag, args, copyText: text.trim() };
  }
  const m = /<skill\s+name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*([\s\S]*)$/.exec(text);
  if (m) {
    const args = (m[2] ?? "").replace(/^\s*\n\s*/, "").trim();
    return { skillTag: m[1]!, args, copyText: `/skill:${m[1]}${args ? " " + args : ""}` };
  }
  return { args: text, copyText: text };
}

/** Split text into text/skill segments; skill blocks render as collapsible tags. */
function renderTextWithSkills(text: string): JSX.Element {
  const parts: TextPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(SKILL_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", text: text.slice(last, m.index) });
    parts.push({ type: "skill", name: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts.length > 0 ? <SkillBlockParts parts={parts} /> : <>{text}</>;
}

/** In-flight compaction marker — spinner + label, centered. */
function CompactingIndicator({ text }: { text: string }): JSX.Element {
  const t = useTokens();
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 999,
          border: "1px solid rgba(99,102,241,0.18)",
          background: "linear-gradient(135deg, rgba(99,102,241,0.07), rgba(139,92,246,0.03))",
          color: t.color.muted,
          fontSize: "0.85em",
        }}
      >
        <span
          style={{
            width: 13,
            height: 13,
            borderRadius: "50%",
            border: "2px solid rgba(99,102,241,0.25)",
            borderTopColor: "#6366f1",
            animation: "vagus-spin 0.8s linear infinite",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        {text}
      </div>
    </div>
  );
}

/** Max width for assistant/tool message bodies. */
export const MESSAGE_MAX_WIDTH = 1000;

/** One file changed within a single turn (aggregated from its tool edits). */
export interface TurnFile {
  file: string;
  added: number;
  removed: number;
  /** Display diff for this file, this turn (edits concatenated). */
  diff?: string;
  /** Unified patch for this file, this turn (edits concatenated). */
  patch?: string;
  /** Fingerprint of this turn — the last edit's toolCallId (shared by all files in the turn). */
  turnToolCallId?: string;
}

type ChatGroup =
  | { kind: "item"; item: ChatItem }
  | { kind: "work"; work: ChatItem[] }
  | { kind: "turnSummary"; files: TurnFile[] };

/**
 * Groups each user turn into one work block plus the final answer.
 *
 * Everything the agent does before the final reply — thinking, tool calls,
 * and the short intermediate texts interleaved between them — belongs to the
 * work content of that turn (rendered in chronological order when expanded):
 *   thinking → tool → "我看看…" → thinking → tool → "再看…" → …
 * The trailing assistant text(s) with no work after them are the final
 * answer and stay plain, right below the work block.
 */
export function groupChatItems(items: ChatItem[]): ChatGroup[] {
  const out: ChatGroup[] = [];
  let work: ChatItem[] = [];
  let finalReply: ChatItem[] = [];
  // Pi occasionally replays an identical thinking block (e.g. on steer or a
  // re-run); dedupe within a turn so a duplicated card can't push the real
  // answer back into the work block.
  let seenThinking = new Set<string>();

  const flushTurn = (): void => {
    if (work.length > 0) out.push({ kind: "work", work });
    for (const r of finalReply) out.push({ kind: "item", item: r });
    // Per-turn change summary (Zed-style): the files this turn's tools
    // edited, aggregated with added/removed counts + concatenated diffs.
    const edits = collectEdits(work);
    if (edits.length > 0) {
      const byFile = new Map<string, TurnFile>();
      for (const e of edits) {
        const cur = byFile.get(e.file) ?? { file: e.file, added: 0, removed: 0 };
        cur.added += e.added;
        cur.removed += e.removed;
        if (e.diff) cur.diff = cur.diff ? `${cur.diff}\n${e.diff}` : e.diff;
        if (e.patch) cur.patch = cur.patch ? `${cur.patch}\n${e.patch}` : e.patch;
        byFile.set(e.file, cur);
      }
      // Turn fingerprint: the last edit's toolCallId — stable across reloads,
      // lets the right-pane reviewer rebuild this turn's files from items.
      const turnToolCallId = edits[edits.length - 1]!.toolCallId;
      const files = [...byFile.values()].map((f) => ({ ...f, turnToolCallId }));
      out.push({ kind: "turnSummary", files });
    }
    work = [];
    finalReply = [];
    seenThinking = new Set<string>();
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.kind === "thinking" || item.kind === "tool") {
      if (item.kind === "thinking") {
        if (seenThinking.has(item.text)) continue; // duplicate replay — skip
        seenThinking.add(item.text);
      }
      work.push(item);
    } else if (item.kind === "assistant") {
      // All assistant texts except the turn's final answer are intermediate
      // replies — they belong INSIDE the work content, in chronological order
      // (thinking → tool → "我看看…" → thinking → tool → …). The final answer
      // (the trailing assistant with nothing after it) stays plain below.
      let trailingFinal = true;
      let workInTurn = work.length > 0;
      for (let j = i + 1; j < items.length; j++) {
        const nxt = items[j]!;
        if (nxt.kind === "user" || nxt.kind === "system") break; // next turn
        if (nxt.kind === "thinking" || nxt.kind === "tool") {
          workInTurn = true;
          trailingFinal = false;
          break;
        }
        if (nxt.kind === "assistant") {
          trailingFinal = false;
          break;
        }
      }
      if (trailingFinal || !workInTurn) finalReply.push(item);
      else work.push(item);
    } else {
      // user / system: a new turn begins — flush the previous one.
      flushTurn();
      out.push({ kind: "item", item });
    }
  }
  flushTurn();
  return out;
}

/**
 * Removes duplicate thinking cards within a turn. Pi can re-run a turn
 * (auto-retry / steer replay) and emit the exact same reasoning twice; the
 * duplicate sits AFTER the final answer, which would otherwise misclassify
 * the reply as intermediate work content and hide it from the timeline.
 * Keeps only the first occurrence of each identical thinking text per turn.
 */
export function dedupeThinking(items: ChatItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  let seen = new Set<string>();
  for (const item of items) {
    if (item.kind === "user") {
      seen = new Set();
      out.push(item);
    } else if (item.kind === "thinking") {
      if (seen.has(item.text)) continue; // duplicate — skip
      seen.add(item.text);
      out.push(item);
    } else {
      out.push(item);
    }
  }
  return out;
}

export interface ChatMessageProps {
  item: ChatItem;
  onToggleCard?: (id: number) => void;
  /** Copy a user message text to clipboard. */
  onCopy?: (text: string) => void;
  /** Submit an edited user message (sends as a new message instead of forking). */
  onEditSubmit?: (text: string) => void;
}

/**
 * Memoized chat message. The stream reducer only replaces the LAST item per
 * delta; every other ChatItem keeps its reference across renders, so the
 * `item` reference comparison below lets unchanged messages skip re-render
 * entirely during streaming (the only re-rendered ones are the live tail).
 * Callbacks are intentionally not compared: they're stable behavior (dispatch
 * / copy) and any real change (session switch) rebuilds items from scratch.
 */
function ChatMessageInner({ item, onToggleCard, onCopy, onEditSubmit }: ChatMessageProps): JSX.Element {
  const t = useTokens();
  if (item.kind === "user") {
    return <UserMessage item={item} onCopy={onCopy} onEditSubmit={onEditSubmit} />;
  }

  if (item.kind === "assistant") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <div style={{
          maxWidth: MESSAGE_MAX_WIDTH,
          minWidth: 0, // let long unbroken strings (URLs) wrap inside flex
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          fontSize: "1em", lineHeight: 1.65, color: t.color.fg,
        }}>
          <Markdown text={item.text} />
        </div>
      </div>
    );
  }

  if (item.kind === "thinking") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-start", maxWidth: MESSAGE_MAX_WIDTH, width: "100%" }}>
        <ThinkingCard item={item} onToggle={() => onToggleCard?.(item.id)} />
      </div>
    );
  }

  if (item.kind === "tool") {
    return (
      <div style={{ display: "flex", justifyContent: "flex-start", maxWidth: MESSAGE_MAX_WIDTH, width: "100%" }}>
        <ToolCard item={item} onToggle={() => onToggleCard?.(item.id)} />
      </div>
    );
  }

  // system — compaction/branch-summary notes get a brand-tinted card;
  // the in-flight compacting marker gets a spinner; other system notices
  // (welcome, errors) stay as centered muted text.
  if (item.text.startsWith("◌ 前文已摘要") || item.text.startsWith("◔ 分支摘要")) {
    return <CompactionNote text={item.text} />;
  }
  if (item.text.startsWith("正在压缩")) {
    return <CompactingIndicator text={item.text} />;
  }
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <span style={{ color: t.color.muted, fontSize: "0.86em" }}>{item.text}</span>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageInner, (a, b) => a.item === b.item);

/** Small icon button under user messages (copy / edit). */
const userToolBtnStyle: CSSProperties = {
  width: 26, height: 26, borderRadius: 6, border: "none", background: "transparent",
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "inherit",
};

function UserMessage({ item, onCopy, onEditSubmit }: { item: Extract<ChatItem, { kind: "user" }>; onCopy?: (text: string) => void; onEditSubmit?: (text: string) => void }): JSX.Element {
  const t = useTokens();
  const parsed = parseSkillMessage(item);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(parsed.copyText);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  // Close the image lightbox on Esc.
  useEffect(() => {
    if (preview === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  const handleCopy = (): void => {
    onCopy?.(parsed.copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const toolBtn = (color: string): CSSProperties => ({ ...userToolBtnStyle, color });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, maxWidth: "100%" }}>
      {editing ? (
        <>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            style={{
              width: "100%", maxWidth: 520, minHeight: 64,
              background: t.color.bg, border: `1px solid #6366f1`, borderRadius: 12,
              padding: "8px 10px", fontSize: "0.95em", lineHeight: 1.5, color: t.color.fg,
              outline: "none", resize: "vertical", fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => { setEditing(false); setDraft(parsed.copyText); }}
              style={{
                height: 30, padding: "0 12px", borderRadius: 8, border: `1px solid ${t.color.border}`,
                background: "transparent", color: t.color.muted, fontSize: "0.86em", cursor: "pointer", fontFamily: "inherit",
              }}
            >取消</button>
            <button
              onClick={() => { if (draft.trim()) onEditSubmit?.(draft.trim()); setEditing(false); }}
              style={{
                height: 30, padding: "0 14px", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff",
                fontSize: "0.86em", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >发送</button>
          </div>
        </>
      ) : (
        <>
          {/* image attachments (shown above the text bubble) */}
          {item.images && item.images.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "70%" }}>
              {item.images.map((img, i) => (
                <img
                  key={i}
                  src={img.dataUrl}
                  alt="附件"
                  style={{
                    width: 80, height: 80, borderRadius: 8,
                    border: `1px solid ${t.color.border}`, objectFit: "cover",
                    background: t.color.bg, cursor: "zoom-in",
                  }}
                  onClick={() => setPreview(img.dataUrl)}
                  title="点击查看大图"
                />
              ))}
            </div>
          )}
          <div
            style={{
              background: t.color.surface,
              border: `1px solid ${t.color.border}`,
              borderRadius: "14px 14px 4px 14px",
              padding: "10px 14px",
              maxWidth: "70%",
              color: t.color.fg,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: "1em",
              lineHeight: 1.55,
            }}
          >
            {parsed.skillTag ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 6, fontSize: "0.85em", background: "rgba(210,153,34,0.10)", border: "1px solid rgba(210,153,34,0.30)", color: t.color.warning, fontFamily: t.font.mono }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V5.5a.5.5 0 0 0-.5-.5H6.5A2.5 2.5 0 0 0 4 7.5v12z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/><path d="M12 6.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/></svg>
                  {parsed.skillTag}
                </span>
                <span>{parsed.args}</span>
              </span>
            ) : (
              item.text && /<skill\s/.test(item.text) ? renderTextWithSkills(item.text) : parsed.args
            )}
          </div>
          {(onCopy || onEditSubmit) && (
            <div
              style={{ display: "flex", gap: 4, opacity: 0.55, transition: "opacity 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.55"; }}
            >
              {onCopy && (
                <button
                  onClick={handleCopy}
                  title={copied ? "已复制" : "复制"}
                  style={{ ...toolBtn(copied ? "#16a34a" : t.color.muted), transition: "color 0.15s" }}
                >
                  {copied ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6L9 17l-5-5"/></svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  )}
                </button>
              )}
              {onEditSubmit && (
                <button onClick={() => { setDraft(parsed.copyText); setEditing(true); }} title="编辑" style={toolBtn(t.color.muted)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4z"/></svg>
                </button>
              )}
            </div>
          )}
        </>
      )}
      {/* image lightbox — rendered to <body> so fixed positioning never breaks */}
      {preview !== null && createPortal(
        <div
          onClick={() => setPreview(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.78)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <img
            src={preview}
            alt="查看大图"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 10, boxShadow: "0 12px 48px rgba(0,0,0,0.5)" }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Format a duration in ms → "0.8s" / "12s" / "1m 23s". */
function fmtDur(ms: number): string {
  const s = ms / 1000;
  if (s < 1) return `${Math.round(ms)}ms`;
  if (s < 60) return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return sec === 0 ? `${m}m` : `${m}m ${sec}s`;
}

/**
 * Ticking duration label, isolated from the work block so its 250ms
 * re-render only touches this small span (not the whole work content).
 * Ticks only while the duration is still evolving (not yet stamped).
 */
function DurLabel({ stampedMs, startMs }: { stampedMs: number; startMs?: number }): JSX.Element | null {
  const [, setTick] = useState(0);
  const done = stampedMs > 0;
  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [done]);
  const ms = done ? stampedMs : startMs !== undefined ? Math.max(0, Date.now() - startMs) : 0;
  if (ms <= 0) return null;
  return <>{fmtDur(ms)}</>;
}

function WorkBlockInner({ work, onToggleItem, live, startMs, attached, attachedAnchor }: {
  work: ChatItem[];
  onToggleItem: (id: number) => void;
  live?: boolean;
  startMs?: number;
  /** Optional extra content rendered INSIDE the block right after the tool
   *  at `attachedAnchor` (e.g. extension-UI cards awaiting the user) —
   *  collapses with the block. */
  attached?: React.ReactNode;
  /** Index into `work` — the tool that triggered `attached` (cards go right
   *  after that tool call, before any following thinking/reply). */
  attachedAnchor?: number;
}): JSX.Element | null {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const wasLive = useRef(false);
  /** Set once the user manually collapses — no auto-expand for this turn. */
  const userCollapsed = useRef(false);

  // Auto-expand while the agent is streaming this turn's work content;
  // auto-collapse once it ends (final answer starts). If the user collapsed
  // it mid-turn, respect that choice — no auto-expand until the next turn.
  useEffect(() => {
    if (live) {
      wasLive.current = true;
      if (!userCollapsed.current) setOpen(true);
    } else if (wasLive.current) {
      wasLive.current = false;
      setOpen(false);
      userCollapsed.current = false; // fresh turn may auto-open again
    }
  }, [live]);

  if (work.length === 0) return null;
  const tools = work.filter((w) => w.kind === "tool").length;
  const thinkings = work.filter((w) => w.kind === "thinking").length;
  // Duration = the whole turn (question → turn end, incl. the final answer):
  // fixed once turnEnd stamped it on the last work item, otherwise elapsed
  // since the turn started (live streaming).
  const stampedMs = work.reduce(
    (m, w) => Math.max(m, w.kind === "thinking" || w.kind === "tool" ? (w.turnDurationMs ?? 0) : 0),
    0,
  );
  const hasDur = stampedMs > 0 || startMs !== undefined;
  // Everything the agent did before its final answer — tools, thinking, or
  // both — is one 工作内容 block, with counts and the full-turn duration.
  const hasTools = tools > 0;
  const counts = hasTools
    ? `${tools} 个工具` + (thinkings > 0 ? ` · ${thinkings} 次思考` : "")
    : thinkings > 0
      ? `${thinkings} 次思考`
      : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* bare text row — no background, no border, aligned with the reply */}
      <button
        onClick={() => { setOpen((o) => { const next = !o; if (!next) userCollapsed.current = true; return next; }); }}
        title={open ? "收起工作内容" : "展开工作内容"}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "fit-content", textAlign: "left",
          border: "none", background: "transparent", padding: "2px 0", cursor: "pointer",
          color: t.color.muted, fontSize: "0.89em",
        }}
      >
        <span style={{ fontSize: "0.71em", color: t.color.muted, flexShrink: 0, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        <span style={{ color: "#6366f1", fontWeight: 600 }}>工作内容</span>
        <span style={{ color: t.color.muted }}>
          {counts}
          {counts !== "" && hasDur && " · "}
          <DurLabel stampedMs={stampedMs} startMs={startMs} />
        </span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
          {work.map((item, idx) => (
            <div key={`w${item.id}`} style={{ display: "contents" }}>
              <ChatMessage item={item} onToggleCard={() => onToggleItem(item.id)} />
              {/* Extension-UI cards right after the trigger tool (chronological) */}
              {attached && idx === attachedAnchor && attached}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized work block. `work` items keep their references across stream
 * deltas (reducer only mutates the tail), so an item-reference comparison
 * skips re-render for untouched turns — only the live block re-renders per
 * token. `onToggleItem`/`attached` are stable behavior or undefined for the
 * common no-card case, so they're not compared.
 */
export const WorkBlock = memo(
  WorkBlockInner,
  (a, b) =>
    a.live === b.live &&
    a.startMs === b.startMs &&
    a.attachedAnchor === b.attachedAnchor &&
    a.attached === b.attached &&
    a.work.length === b.work.length &&
    a.work.every((w, i) => w === b.work[i]),
);

function ThinkingCard({ item, onToggle }: { item: Extract<ChatItem, { kind: "thinking" }>; onToggle: () => void }): JSX.Element {
  const t = useTokens();
  const collapsed = item.collapsed === true;
  return (
    <button
      onClick={onToggle}
      title={collapsed ? "展开思考" : "收起思考"}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: `1px solid rgba(99,102,241,0.2)`,
        borderRadius: 8,
        background: "linear-gradient(135deg, rgba(99,102,241,0.07), rgba(139,92,246,0.04))",
        padding: "8px 12px",
        cursor: "pointer",
        color: t.color.fg,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: t.color.muted, fontSize: "0.86em" }}>{collapsed ? "▶" : "▼"}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.8" style={{ flexShrink: 0 }}>
          <path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08A2.5 2.5 0 0 0 12 19.5a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 12 4.5z"/>
        </svg>
        <span style={{ color: "#6366f1", fontSize: "0.88em", fontWeight: 600, letterSpacing: "0.02em" }}>思考</span>
        <span style={{ marginLeft: "auto", color: t.color.muted, fontSize: "0.79em" }}>{item.text.length} chars</span>
      </div>
      {!collapsed && (
        <div
          style={{
            marginTop: 6,
            color: t.color.muted,
            fontSize: "0.86em",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {item.text}
        </div>
      )}
    </button>
  );
}

function ToolCard({ item, onToggle }: { item: Extract<ChatItem, { kind: "tool" }>; onToggle: () => void }): JSX.Element {
  const t = useTokens();
  const collapsed = item.collapsed === true;
  const statusColor =
    item.status === "succeeded" ? t.color.success : item.status === "failed" ? t.color.error : t.color.warning;

  return (
    <div
      style={{
        border: `1px solid rgba(99,102,241,0.18)`,
        borderRadius: 8,
        background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.03))",
        padding: "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: "100%",
      }}
    >
      {/* Header: tool name + status (click toggles details) */}
      <button
        onClick={onToggle}
        title={collapsed ? "展开详情" : "收起详情"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ color: t.color.muted, fontSize: "0.86em" }}>{collapsed ? "▶" : "▼"}</span>
        <span style={{ color: statusColor, fontSize: "0.86em" }}>⚙</span>
        <span style={{ color: "#6366f1", fontSize: "0.93em", fontWeight: 600, flexShrink: 0 }}>{item.name}</span>
        {item.args && (
          <span style={{ color: t.color.muted, fontSize: "0.79em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {item.args}
          </span>
        )}
        {/* Reserved status area — fixed width so long names/args never wrap it
            to a second line or shift it around. */}
        <span style={{ marginLeft: "auto", width: 72, flexShrink: 0, textAlign: "right", whiteSpace: "nowrap", fontSize: "0.86em", color: statusColor, fontWeight: 600 }}>
          {item.status === "running" ? "● running" : item.status === "succeeded" ? "✓ done" : "✗ failed"}
        </span>
      </button>

      {/* Details (collapsible) — renders a red/green diff for edit tools */}
      {!collapsed && (
        <>
          {item.diff ? (
            <DiffView diff={item.diff} t={t} full maxHeight={400} />
          ) : (
            item.result && (
              <pre
                style={{
                  background: t.color.bg,
                  border: `1px solid ${t.color.border}`,
                  borderRadius: 6,
                  padding: "8px 10px",
                  margin: 0,
                  maxHeight: 240,
                  overflow: "auto",
                  fontSize: "0.79em",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: t.color.muted,
                }}
              >
                {item.result}
              </pre>
            )
          )}
        </>
      )}
    </div>
  );
}

/** One parsed line of pi's display diff. */
/** One parsed line of a file diff. */
interface DiffLine {
  marker: string; // "+" | "-" | " " (context)
  lineNum: string;
  content: string;
}

/** Parses a diff (unified patch OR pi's display format) into segments. */
function parseDiffSegments(diff: string): Array<{ kind: "context" | "change"; lines: DiffLine[] }> {
  const lines = diff.split("\n");
  const isUnified = lines.some((l) => l.startsWith("--- ") || l.startsWith("diff --git"));
  return isUnified ? parseUnifiedSegments(lines) : parseDisplaySegments(lines);
}

/** Parses pi's display diff (`+N`/`-N`/` N` rows) into context/change segments. */
function parseDisplaySegments(lines: string[]): Array<{ kind: "context" | "change"; lines: DiffLine[] }> {
  const segs: Array<{ kind: "context" | "change"; lines: DiffLine[] }> = [];
  let cur: DiffLine[] = [];
  let curKind: "context" | "change" | null = null;

  for (const raw of lines) {
    const marker = raw[0] ?? "";
    const numEnd = raw.indexOf(" ", 1);
    const lineNum = numEnd === -1 ? "" : raw.slice(1, numEnd).trim();
    const content = numEnd === -1 ? raw.slice(1) : raw.slice(numEnd + 1);
    // Skip the "..." context-ellipsis lines from pi's display diff.
    if (content.trim() === "...") continue;
    const kind: "context" | "change" = marker === "+" || marker === "-" ? "change" : "context";
    if (kind !== curKind) {
      if (cur.length > 0 && curKind) segs.push({ kind: curKind, lines: cur });
      cur = [];
      curKind = kind;
    }
    cur.push({ marker, lineNum, content });
  }
  if (cur.length > 0 && curKind) segs.push({ kind: curKind, lines: cur });
  return segs;
}

/** Parses a unified patch (`--- a/` `+++ b/` `@@` hunks) into segments. */
function parseUnifiedSegments(lines: string[]): Array<{ kind: "context" | "change"; lines: DiffLine[] }> {
  const segs: Array<{ kind: "context" | "change"; lines: DiffLine[] }> = [];
  let cur: DiffLine[] = [];
  let curKind: "context" | "change" | null = null;
  let oldLine = 0;
  let newLine = 0;

  const flush = (): void => {
    if (cur.length > 0 && curKind) segs.push({ kind: curKind, lines: cur });
    cur = [];
    curKind = null;
  };

  for (const raw of lines) {
    // Skip headers / hunk metadata.
    if (raw.startsWith("--- ") || raw.startsWith("+++ ") || raw.startsWith("diff --git") || raw.startsWith("index ") || raw.startsWith("\\")) continue;
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      flush();
      oldLine = Number(hunk[1]) - 1;
      newLine = Number(hunk[2]) - 1;
      continue;
    }
    const marker = raw[0] ?? "";
    const content = marker === " " || marker === "+" || marker === "-" ? raw.slice(1) : raw;
    const kind: "context" | "change" = marker === "+" || marker === "-" ? "change" : "context";
    if (kind !== curKind) {
      flush();
      curKind = kind;
    }
    let lineNum = "";
    if (marker === "+") { newLine++; lineNum = String(newLine); }
    else if (marker === "-") { oldLine++; lineNum = String(oldLine); }
    else { oldLine++; newLine++; lineNum = String(newLine); }
    cur.push({ marker, lineNum, content });
  }
  flush();
  return segs;
}

/**
 * Git-style file-edit diff: single-column layout with a fixed line-number
 * gutter. Added lines get a green background + left edge, removed lines get
 * red. Long runs of unmodified context are folded into a rounded "N
 * unmodified lines" bar — informational only, no expand buttons.
 */
export function DiffView({ diff, t, maxHeight, full }: { diff: string; t: ReturnType<typeof useTokens>; maxHeight?: number; full?: boolean }): JSX.Element {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const segments = useMemo(() => parseDiffSegments(diff), [diff]);

  const pal = dark
    ? { addBg: "rgba(34,197,94,0.15)", addFg: "#4ade80", addEdge: "#4ade80",
        delBg: "rgba(239,68,68,0.15)", delFg: "#f87171", delEdge: "#f87171",
        foldBg: "rgba(255,255,255,0.05)", foldFg: "#9ca3af",
        text: t.color.fg, numFg: "#6b7280", border: t.color.border }
    : { addBg: "#f0fdf4", addFg: "#16a34a", addEdge: "#16a34a",
        delBg: "#fef2f2", delFg: "#ef4444", delEdge: "#ef4444",
        foldBg: "#f3f4f6", foldFg: "#6b7280",
        text: "#1f2937", numFg: "#9ca3af", border: "#e5e7eb" };

  const renderLine = (dl: DiffLine, idx: number, keyPrefix: string): JSX.Element => {
    const isAdd = dl.marker === "+";
    const isDel = dl.marker === "-";
    const bg = isAdd ? pal.addBg : isDel ? pal.delBg : "transparent";
    const edge = isAdd ? pal.addEdge : isDel ? pal.delEdge : "transparent";
    const numColor = isAdd ? pal.addFg : isDel ? pal.delFg : pal.numFg;
    return (
      <div
        key={`${keyPrefix}-${idx}`}
        style={{
          display: "flex", whiteSpace: "pre", background: bg, minWidth: "100%",
          borderLeft: `3px solid ${edge}`, lineHeight: "26px", minHeight: 26,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: "0.92em", color: pal.text,
        }}
      >
        <span style={{ flexShrink: 0, width: 50, textAlign: "right", paddingRight: 10, userSelect: "none", color: numColor }}>
          {dl.lineNum}
        </span>
        <span style={{ flexShrink: 0, width: 18, textAlign: "center", userSelect: "none", color: numColor }}>
          {dl.marker === " " ? " " : dl.marker}
        </span>
        <span style={{ whiteSpace: "pre", background: bg }}>{dl.content}</span>
      </div>
    );
  };

  const foldBar = (count: number, key: string): JSX.Element => (
    <div
      key={key}
      style={{
        display: "flex", alignItems: "center",
        justifyContent: "flex-start",
        padding: "2px 10px", // left-aligned at the very edge
        background: pal.foldBg, borderRadius: 6,
        margin: "2px 0", color: pal.foldFg, fontSize: "0.75em",
        fontFamily: "system-ui, -apple-system, sans-serif", userSelect: "none",
      }}
    >
      {count} unmodified lines
    </div>
  );

  return (
    <div
      style={{
        background: dark ? t.color.bg : "#ffffff",
        border: `1px solid ${pal.border}`,
        borderRadius: 8,
        margin: 0,
        maxHeight: maxHeight ?? "none",
        overflowX: "auto",
        overflowY: maxHeight !== undefined ? "auto" : "hidden",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: "0.92em",
        lineHeight: "26px",
      }}
    >
      {/* Inner wrapper: width = longest line, uniform row backgrounds;
          overflows trigger the outer horizontal scrollbar. */}
      <div style={{ width: "max-content", minWidth: "100%" }}>
      {segments.map((seg, si) => {
        if (seg.kind === "change") {
          return <div key={`s${si}`}>{seg.lines.map((l, li) => renderLine(l, li, `s${si}`))}</div>;
        }
        // Full mode (tool card): show only changes, skip context entirely.
        if (full) return null;
        // context segment: fold if >2 lines (unless full mode shows everything)
        if (!full && seg.lines.length > 2) {
          const kept = [seg.lines[0]!, seg.lines[seg.lines.length - 1]!];
          const folded = seg.lines.length - 2;
          return (
            <div key={`s${si}`}>
              {renderLine(kept[0]!, 0, `s${si}-a`)}
              {foldBar(folded, `s${si}-f`)}
              {renderLine(kept[1]!, 1, `s${si}-b`)}
            </div>
          );
        }
        return <div key={`s${si}`}>{seg.lines.map((l, li) => renderLine(l, li, `s${si}-c`))}</div>;
      })}
      {segments.length === 0 && (
        <div style={{ padding: "8px 10px", color: pal.numFg, fontSize: "0.85em", fontFamily: "system-ui, sans-serif" }}>（无 diff）</div>
      )}
      </div>
    </div>
  );
}
