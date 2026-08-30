import { useMemo, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";
import { DiffView, groupChatItems, normalizePath } from "@vagus/ui-chat";
import type { ChatItem } from "@vagus/ui-chat";
import type { RightTab } from "./right-panel.js";

/**
 * Diff tab definition for the right panel.
 * The tab label is "审阅" with a chart icon.
 */
export const DIFF_TAB: RightTab = {
  id: "diff",
  label: "审阅",
  icon: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l3 3 3-6 4 9 3-5 2 2" />
    </svg>
  ),
};

/** One row in the reviewer: a file with its diff + line stats. */
interface ScopeEntry {
  file: string;
  diff?: string;
  patch?: string;
}

/**
 * Renders the diff tab content — a Zed-style list of the files changed in
 * ONE turn: expander, gray path + bold filename, green/red line counts.
 * The clicked file is expanded by default; clicking any row toggles it.
 *
 * The turn is identified by `turnId` (the turn fingerprint, shared by all its
 * files) and rebuilt from the session items — so the diff is always current,
 * and the pane never aggregates across turns. With no `turnId` the pane is
 * empty (the panel only shows a turn the user explicitly reviewed).
 */
export function DiffTabContent({
  items,
  selected,
  turnId,
  expandedFiles,
  onOpenChange,
}: {
  items: ChatItem[];
  selected?: string;
  turnId?: string;
  /** The files currently expanded in the review list (persisted per session). */
  expandedFiles?: string[];
  /** Called when the user expands/collapses file rows. */
  onOpenChange?: (files: string[] | undefined) => void;
}): JSX.Element | null {
  const t = useTokens();
  // Rebuild the reviewed turn's files from items (latest diff, no snapshots).
  const entries = useMemo<ScopeEntry[]>(() => {
    if (!turnId) return [];
    const groups = groupChatItems(items);
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i]!;
      if (g.kind === "turnSummary" && g.files.some((f) => f.turnToolCallId === turnId)) return g.files;
    }
    return [];
  }, [turnId, items]);
  // Multiple files can be expanded at once; restored files win, else the first
  // file. The component is remounted (key) across sessions/turns so this is
  // correct on first paint.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>();
    // Persisted open files ([] = all collapsed). `undefined` = never set —
    // default to the first file.
    if (expandedFiles !== undefined) {
      for (const f of expandedFiles) {
        if (entries.some((s) => normalizePath(s.file) === normalizePath(f))) init.add(f);
      }
    } else if (entries.length > 0) {
      init.add(entries[0]!.file);
    }
    return init;
  });
  const isOpenRow = (file: string): boolean => [...expanded].some((e) => normalizePath(e) === normalizePath(file));
  const toggle = (file: string): void => {
    const next = new Set(expanded);
    if (isOpenRow(file)) next.delete([...next].find((e) => normalizePath(e) === normalizePath(file))!);
    else next.add(file);
    setExpanded(next);
    onOpenChange?.(next.size > 0 ? [...next] : undefined);
  };

  const empty = (
    <div
      style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, color: t.color.muted, fontSize: "0.85em", textAlign: "center",
        lineHeight: 1.6, fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      此会话暂无文件改动<br />让 agent 编辑文件后可在此审阅 diff
    </div>
  );

  if (entries.length === 0) return empty;
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "6px 0" }}>
      {entries.map((entry, idx) => {
          const slash = entry.file.lastIndexOf("/");
          const dir = slash >= 0 ? entry.file.slice(0, slash + 1) : "";
          const name = slash >= 0 ? entry.file.slice(slash + 1) : entry.file;
          const isOpen = isOpenRow(entry.file);
          const counts = countDiffLines(entry.diff ?? "");
          return (
            <div key={entry.file} style={{ borderBottom: idx < entries.length - 1 ? `1px solid ${t.color.border}20` : "none" }}>
              {/* Row: expander → path → counts → actions */}
              <div
                onClick={() => toggle(entry.file)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", cursor: "pointer", userSelect: "none",
                  background: idx % 2 === 1 ? t.color.surface : "transparent",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.color.sidebarHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 1 ? t.color.surface : "transparent"; }}
              >
                {/* Green expander chevron */}
                <svg
                  width="11" height="11" viewBox="0 0 24 24" fill="none"
                  stroke={t.color.success} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0, transition: "transform 0.15s", transform: isOpen ? "rotate(90deg)" : "none" }}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.8em" }}>
                  <span style={{ color: t.color.muted }}>{dir}</span>
                  <span style={{ color: t.color.fg, fontWeight: 700 }}>{name}</span>
                </span>
                <span style={{ color: t.color.success, fontSize: "0.75em", fontWeight: 600, flexShrink: 0 }}>+{counts.added}</span>
                <span style={{ color: t.color.error, fontSize: "0.75em", fontWeight: 600, flexShrink: 0 }}>-{counts.removed}</span>
              </div>
              {/* Expanded diff */}
              {/* Expanded diff — grid-template-rows animates the collapse/expand. */}
              <div style={{ display: "grid", gridTemplateRows: isOpen ? "1fr" : "0fr", transition: "grid-template-rows 0.22s ease" }}>
                <div style={{ overflow: "hidden", minHeight: 0 }}>
                  <div style={{ padding: "2px 8px 8px", background: t.color.bg }}>
                    {entry.diff ? <DiffView diff={entry.diff} t={t} /> : <div style={{ color: t.color.muted, fontSize: "0.78em", padding: 6 }}>该轮无 diff</div>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
  );
}

/** Counts added/removed lines in a display/unified diff. */
function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

