import { useMemo, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";
import type { SessionHistoryItem } from "@vagus/ui-tokens";
import { BubbleIcon, collapsible, projectName, timeAgo, ROW_TRANSITION } from "./common.js";

export interface ArchivedProject {
  cwd: string;
  /** Encoded archive-dir name — the unique identity of this archived group. */
  dirKey: string;
  sessions: SessionHistoryItem[];
}

/**
 * The "已归档" section of the sidebar — archived projects (and their
 * sessions) live here until restored or permanently deleted.
 */
export function ArchiveSection(props: {
  archivedProjects: ArchivedProject[];
  busyPaths: Set<string>;
  /** Project-collapse state shared with the main tree (keys prefixed "arch:"). */
  collapsed: Set<string>;
  onToggleProject: (key: string) => void;
  onOpenSession: (path: string) => void;
  onSessionContextMenu: (e: React.MouseEvent, session: SessionHistoryItem, archived: boolean) => void;
  onProjectContextMenu: (e: React.MouseEvent, cwd: string, dirKey: string) => void;
  /** Right-click on the section title — clear ALL archived projects. */
  onSectionContextMenu?: (e: React.MouseEvent) => void;
}): JSX.Element | null {
  const t = useTokens();
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    return props.archivedProjects
      .filter((p) => p.sessions.length > 0)
      .toSorted((a, b) => b.sessions[0]!.modified.localeCompare(a.sessions[0]!.modified));
  }, [props.archivedProjects]);

  if (props.archivedProjects.length === 0) return null;

  return (
    <>
      {/* 已归档 — archived projects live here until permanently deleted */}
      <div
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => { if (props.onSectionContextMenu) { e.preventDefault(); props.onSectionContextMenu(e); } }}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px", borderRadius: 8, cursor: "pointer", userSelect: "none",
          fontSize: "0.88em", fontWeight: 500, color: t.color.muted, marginTop: 8,
          transition: ROW_TRANSITION,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0 }}><path d="M21 8l-2-4H5L3 8v2h18V8z"/><path d="M3 10v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/><path d="M12 13v3"/></svg>
        <span style={{ flex: 1, textAlign: "left" }}>已归档</span>
        <span style={{ fontSize: "0.75em", color: t.color.muted, background: t.color.sidebarHover, borderRadius: 8, padding: "1px 7px" }}>{props.archivedProjects.length}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, transform: open ? "rotate(0)" : "rotate(-90deg)", transition: "transform 0.15s ease" }}><path d="M9 18l6-6-6-6"/></svg>
      </div>
      {collapsible(open, (
        <div style={{ paddingLeft: 6 }}>
          {groups.map(({ cwd, dirKey, sessions: groupSessions }) => {
            const isOpen = !props.collapsed.has(`arch:${cwd}`);
            return (
              <div key={cwd} style={{ marginBottom: 1 }}>
                <div
                  onClick={() => props.onToggleProject(`arch:${cwd}`)}
                  onContextMenu={(e) => props.onProjectContextMenu(e, cwd, dirKey)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 8px", borderRadius: 8, cursor: "pointer", userSelect: "none",
                    fontSize: "0.9em", fontWeight: 500, color: t.color.muted, opacity: 0.85,
                    transition: ROW_TRANSITION,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; e.currentTarget.style.opacity = "0.85"; }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0 }}><path d="M21 8l-2-4H5L3 8v2h18V8z"/><path d="M3 10v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/></svg>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName(cwd)}</span>
                  <span style={{ fontSize: "0.75em", color: t.color.muted, flexShrink: 0 }}>{groupSessions.length}</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, transform: isOpen ? "rotate(0)" : "rotate(-90deg)", transition: "transform 0.15s ease" }}><path d="M9 18l6-6-6-6"/></svg>
                </div>
                {collapsible(isOpen, (
                  <div style={{ paddingLeft: 30 }}>
                    {groupSessions.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => props.onOpenSession(s.path)}
                        onContextMenu={(e) => props.onSessionContextMenu(e, s, true)}
                        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover}
                        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}
                        style={{
                          display: "flex", alignItems: "center", gap: 7,
                          padding: "6px 10px", borderRadius: 10, cursor: "pointer", userSelect: "none",
                          fontSize: "0.89em", color: t.color.muted, overflow: "hidden", whiteSpace: "nowrap",
                          transition: ROW_TRANSITION,
                        }}
                      >
                        <BubbleIcon />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{(s.name ?? s.firstMessage.slice(0, 40)) || "（空会话）"}</span>
                        {props.busyPaths.has(s.path) && (
                          <span title="工作中" style={{ width: 7, height: 7, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", animation: "vagus-pulse 1.2s ease-in-out infinite", flexShrink: 0, display: "inline-block" }} />
                        )}
                        <span style={{ fontSize: "0.79em", color: t.color.muted, flexShrink: 0 }}>{timeAgo(s.modified)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
