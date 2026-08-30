import { useMemo, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";
import type { ChatItem } from "./chat.js";
import { collectEdits } from "./file-edits.js";

/** One file's revert outcome, reported up for the result modal. */
export interface RevertResult {
  file: string;
  toolCallId: string;
  ok: boolean;
  error?: string;
}

/**
 * Total-diff summary panel above the input (pi-agent-studio style).
 *
 * Header shows file count + total added/removed lines with 全部接受 / 全部回退
 * actions; expanding lists each file with its own line counts and per-file
 * ✅接受 / 回退 buttons. A handled file (accepted or reverted) is removed
 * from the list — accepting is a front-end decision (edits are kept as-is),
 * reverting restores the file to its pre-session snapshot (git-free).
 */

export function DiffSummary({
  items,
  onOpenFile,
  onRevert,
  onRevertReport,
  handled,
  onHandledChange,
}: {
  items: ChatItem[];
  /** Open the right-pane diff viewer on this file. */
  onOpenFile: (file: string) => void;
  /** Revert a file to its pre-session state; resolves with the outcome. */
  onRevert: (file: string) => Promise<{ ok: boolean; error?: string }>;
  /** Report collected per-file revert outcomes (successes hide, failures stay). */
  onRevertReport: (results: RevertResult[]) => void;
  /** Files already accepted or reverted — hidden from the list. */
  handled: Set<string>;
  onHandledChange: (next: Set<string>) => void;
}): JSX.Element | null {
  const t = useTokens();
  const [open, setOpen] = useState(false);

  const edits = useMemo(() => collectEdits(items), [items]);
  // A handled edit (by toolCallId) is hidden; unhandled edits stay visible.
  // Keying on the edit instance (not the file path) means a NEW edit to an
  // already-accepted file still shows up for review.
  const pending = useMemo(() => edits.filter((e) => !handled.has(e.toolCallId)), [edits, handled]);
  const files = useMemo(() => [...new Set(pending.map((e) => e.file))], [pending]);

  if (edits.length === 0) return null;
  if (files.length === 0) return null;

  const totalAdded = pending.reduce((s, e) => s + e.added, 0);
  const totalRemoved = pending.reduce((s, e) => s + e.removed, 0);
  const revertable = pending.filter((e) => e.file);

  const acceptAll = (): void => {
    onHandledChange(new Set([...handled, ...pending.map((e) => e.toolCallId)]));
  };
  const revertAll = async (): Promise<void> => {
    const results: RevertResult[] = [];
    const seen = new Set<string>();
    for (const e of revertable) {
      if (seen.has(e.file)) continue;
      seen.add(e.file);
      const res = await onRevert(e.file);
      results.push({ file: e.file, toolCallId: e.toolCallId, ok: res.ok, error: res.error });
    }
    onRevertReport(results);
  };
  const acceptFile = (file: string): void => {
    const ids = pending.filter((e) => e.file === file).map((e) => e.toolCallId);
    onHandledChange(new Set([...handled, ...ids]));
  };
  const revertFile = async (file: string): Promise<void> => {
    const res = await onRevert(file);
    onRevertReport([{ file, toolCallId: pending.find((e) => e.file === file)?.toolCallId ?? file, ok: res.ok, error: res.error }]);
  };

  const btn: React.CSSProperties = {
    height: 24, padding: "0 8px", borderRadius: 6, border: "none",
    fontSize: "0.75em", fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit", flexShrink: 0,
    transition: "background 0.15s, color 0.15s",
  };

  return (
    <div
      style={{
        border: `1px solid ${t.color.border}`,
        borderRadius: 10,
        background: t.color.surface,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      {/* Header: counts + accept-all / revert-all */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0,
            background: "none", border: "none", cursor: "pointer", color: "inherit",
            fontFamily: "inherit", textAlign: "left", padding: 0,
          }}
        >
          <span style={{ color: t.color.muted, fontSize: "0.86em" }}>{open ? "▼" : "▶"}</span>
          <span style={{ color: t.color.fg, fontSize: "0.9em", fontWeight: 600, flexShrink: 0 }}>修改 {files.length} 个文件</span>
          <span style={{ color: "#16a34a", fontSize: "0.8em", fontWeight: 600, flexShrink: 0 }}>+{totalAdded}</span>
          <span style={{ color: "#ef4444", fontSize: "0.8em", fontWeight: 600, flexShrink: 0 }}>-{totalRemoved}</span>
        </button>
        {files.length > 0 && (
          <>
            <button
              onClick={acceptAll}
              title="保留所有改动（前端确认，不移除）"
              style={{ ...btn, background: "rgba(22,163,74,0.12)", color: "#16a34a" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(22,163,74,0.2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(22,163,74,0.12)"; }}
            >
              全部接受
            </button>
            {revertable.length > 0 && (
              <button
                onClick={revertAll}
                title="反向应用所有可回退的编辑"
                style={{ ...btn, background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.18)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
              >
                全部回退
              </button>
            )}
          </>
        )}
      </div>

      {/* File rows */}
      {open && (
        <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column" }}>
          {files.map((file) => {
            const fileEdits = edits.filter((e) => e.file === file);
            const added = fileEdits.reduce((s, e) => s + e.added, 0);
            const removed = fileEdits.reduce((s, e) => s + e.removed, 0);
            // Path split: directory in light gray, filename darker.
            const slash = file.lastIndexOf("/");
            const dir = slash >= 0 ? file.slice(0, slash + 1) : "";
            const name = slash >= 0 ? file.slice(slash + 1) : file;
            return (
              <div
                key={file}
                onClick={() => onOpenFile(file)}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.color.bg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 8px", borderRadius: 8, cursor: "pointer",
                  fontFamily: "inherit", transition: "background 0.15s",
                }}
              >
                {/* Modified status icon */}
                <span
                  style={{
                    flexShrink: 0, width: 16, height: 16, borderRadius: 4,
                    background: "rgba(22,163,74,0.14)", color: "#16a34a",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "0.62em", fontWeight: 700,
                  }}
                >
                  M
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.82em" }}>
                  <span style={{ color: t.color.muted }}>{dir}</span>
                  <span style={{ color: t.color.fg, fontWeight: 500 }}>{name}</span>
                </span>
                <span style={{ color: "#16a34a", fontSize: "0.78em", fontWeight: 600, flexShrink: 0 }}>+{added}</span>
                <span style={{ color: "#ef4444", fontSize: "0.78em", fontWeight: 600, flexShrink: 0 }}>-{removed}</span>
                {/* ✅ Accept (front-end only — edits stay as-is) */}
                <button
                  onClick={(e) => { e.stopPropagation(); acceptFile(file); }}
                  title="接受此文件的改动"
                  style={{
                    width: 24, height: 24, borderRadius: 6, border: "none",
                    background: "rgba(22,163,74,0.12)", color: "#16a34a",
                    cursor: "pointer", display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0, fontFamily: "inherit",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(22,163,74,0.22)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(22,163,74,0.12)"; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </button>
                {/* Revert — git-free: restores the session's pre-edit snapshot */}
                <button
                  onClick={(e) => { e.stopPropagation(); revertFile(file); }}
                  title="回退此文件到会话编辑前状态"
                    style={{
                      width: 24, height: 24, borderRadius: 6, border: "none",
                      background: "rgba(239,68,68,0.1)", color: "#ef4444",
                      cursor: "pointer", display: "flex", alignItems: "center",
                      justifyContent: "center", flexShrink: 0, fontFamily: "inherit",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.18)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                  </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}