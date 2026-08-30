import { memo, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";
import type { TurnFile } from "./messages.js";

/**
 * Per-turn change summary (Zed / VS Code Git SCM-style layout).
 *
 * Rendered at the end of each turn: a header bar ("N 个文件已更改 +N -M")
 * with a 撤销 (undo-all) text button, and an expandable file list — icon +
 * filename + gray path + green/red line counts, plus per-file 审查 (review,
 * inline diff) and 打开 (open in the right-pane diff viewer) buttons.
 * Collapsed by default. Colors follow the app theme (useTokens).
 */

function FileIcon({ ext, muted, accent }: { ext: string; muted: string; accent: string }): JSX.Element {
  if (ext === "py") {
    // Simplified Python two-snake mark (brand yellow + blue).
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path
          d="M14.5 3.5c3.4.4 4.7 2 4.7 4.2v3.2c0 1.7-1.3 2.8-2.8 2.8h-4.2c-2.3 0-4 1.7-4 4v3.4c0 2 1 3.4 3.9 3.4h3.3"
          stroke="#3776ab" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
        />
        <path
          d="M9.5 20.5c-3.4-.4-4.7-2-4.7-4.2v-3.2c0-1.7 1.3-2.8 2.8-2.8h4.2c2.3 0 4-1.7 4-4V3"
          stroke="#ffd43b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (ext === "md") {
    // Markdown "M↓" glyph in a rounded frame, theme accent color.
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z" stroke={accent} strokeWidth="1.5" />
        <path d="M7.5 15.5v-6l2.5 2.5 2.5-2.5v6" stroke={accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14.5 15.5V10M14.5 12h3.5M14.5 15.5h3.5" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  // Generic document.
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M7 3h7l5 5v13H7z" stroke={muted} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke={muted} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export const TurnDiffSummary = memo(function TurnDiffSummary({
  files,
  onOpenFile,
  onRevertAll,
  reverting,
  onExpand,
}: {
  files: TurnFile[];
  /** Open the right-pane reviewer showing this turn's files (the clicked one expanded). */
  onOpenFile: (file: string, turnFiles?: TurnFile[]) => void;
  onRevertAll: () => void;
  reverting?: boolean;
  /** Fired when the summary is expanded — the host can scroll it into view. */
  onExpand?: (open: boolean) => void;
}): JSX.Element | null {
  const t = useTokens();
  const [open, setOpen] = useState(false);

  if (files.length === 0) return null;
  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removed, 0);

  // Low-saturation gray chip, themed.
  const chip: React.CSSProperties = {
    height: 22, padding: "0 10px", borderRadius: 5, border: `1px solid ${t.color.border}`,
    background: t.color.surface, color: t.color.muted, fontSize: "0.72em", fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  };

  return (
    <div
      style={{
        border: `1px solid ${t.color.border}`,
        borderRadius: 8,
        overflow: "hidden",
        background: t.color.bg,
        fontFamily: "inherit",
      }}
    >
      {/* Header bar — one shade deeper than the list; click toggles. */}
      <div
        onClick={() => { setOpen((o) => { const n = !o; onExpand?.(n); return n; }); }}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 12px", background: t.color.surface, cursor: "pointer",
          borderBottom: open ? `1px solid ${t.color.border}` : "none",
          userSelect: "none",
        }}
      >
        <span
          style={{
            color: t.color.muted, fontSize: "0.7em", flexShrink: 0,
            transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none",
          }}
        >
          ▶
        </span>
        <span style={{ color: t.color.fg, fontSize: "0.85em", fontWeight: 600, flexShrink: 0 }}>
          {files.length} 个文件已更改
        </span>
        <span style={{ color: t.color.success, fontSize: "0.8em", fontWeight: 600, flexShrink: 0 }}>
          +{totalAdded}
        </span>
        <span style={{ color: t.color.error, fontSize: "0.8em", fontWeight: 600, flexShrink: 0 }}>
          -{totalRemoved}
        </span>
        <span style={{ flex: 1 }} />
        {/* 撤销 — undo the whole turn; blocked if any file was hand-edited. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRevertAll();
          }}
          disabled={reverting}
          title="撤销本轮的全部更改"
          style={{
            background: "none", border: "none", cursor: reverting ? "wait" : "pointer",
            color: t.color.muted, fontSize: "0.78em", fontWeight: 600,
            fontFamily: "inherit", padding: "2px 6px", borderRadius: 4, flexShrink: 0,
            opacity: reverting ? 0.55 : 1,
            transition: "color 0.15s, background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = t.color.sidebarHover; e.currentTarget.style.color = t.color.fg; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.color.muted; }}
        >
          {reverting ? "撤销中…" : "撤销"}
        </button>
      </div>

      {/* File list — flat rows, no dividers, hover tone separates them. */}
      {/* grid-template-rows 0fr→1fr animates the collapse/expand height. */}
      <div style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr", transition: "grid-template-rows 0.22s ease" }}>
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div style={{ padding: "3px 0", display: "flex", flexDirection: "column" }}>
          {files.map((f) => {
            const slash = f.file.lastIndexOf("/");
            const dir = slash >= 0 ? f.file.slice(0, slash + 1) : "";
            const name = slash >= 0 ? f.file.slice(slash + 1) : f.file;
            const lower = name.toLowerCase();
            const ext = lower.endsWith(".py") ? "py" : lower.endsWith(".md") ? "md" : "other";
            return (
              <div
                key={f.file}
                onClick={() => onOpenFile(f.file, files)}
                title="在右侧面板查看本轮的 diff"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 12px", background: "transparent", cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.color.sidebarHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <FileIcon ext={ext} muted={t.color.muted} accent={t.color.accent} />
                <span
                  style={{
                    flex: 1, minWidth: 0, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.8em",
                  }}
                >
                  <span style={{ color: t.color.fg, fontWeight: 600 }}>{name}</span>
                  {dir && <span style={{ color: t.color.muted }}> {dir}</span>}
                </span>
                <span style={{ color: t.color.success, fontSize: "0.75em", fontWeight: 600, flexShrink: 0 }}>+{f.added}</span>
                <span style={{ color: t.color.error, fontSize: "0.75em", fontWeight: 600, flexShrink: 0 }}>-{f.removed}</span>
                {/* 审查 — open this turn's files in the right-side panel (clicked one first) */}
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenFile(f.file, files); }}
                  title="在右侧面板查看本轮的 diff"
                  style={chip}
                  onMouseEnter={(e) => { e.currentTarget.style.background = t.color.sidebarHover; e.currentTarget.style.color = t.color.fg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = t.color.surface; e.currentTarget.style.color = t.color.muted; }}
                >
                  审查
                </button>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}, (a, b) => {
  // Compare file list by content (names + counts). `files` is rebuilt each
  // group pass; the summary's header and rows are pure functions of it, so
  // equal content means no re-render needed. Callbacks are stable behavior.
  if (a.files.length !== b.files.length) return false;
  for (let i = 0; i < a.files.length; i++) {
    const f = a.files[i]!;
    const g = b.files[i]!;
    if (f.file !== g.file || f.added !== g.added || f.removed !== g.removed || f.turnToolCallId !== g.turnToolCallId) return false;
  }
  return true;
});
