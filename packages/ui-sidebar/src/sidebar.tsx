import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTheme, useTokens } from "@vagus/ui-tokens";
import type { SessionHistoryItem } from "@vagus/ui-tokens";
import { ArchiveSection } from "./archive-section.js";
import { BubbleIcon, collapsible, projectName, timeAgo, ROW_TRANSITION } from "./common.js";

/**
 * Left sidebar — project tree navigation.
 *
 * Sessions are grouped by their cwd (working directory), forming a
 * project → session tree. The top area has a "新对话" primary button and a
 * "插件" placeholder nav item. Projects are collapsible folders. "设置" is
 * pinned at the bottom.
 *
 * Visual language: sidebar sits on `sidebarBg` (one shade deeper than the
 * chat pane), brand-gradient primary button for 新对话, indigo-tinted active
 * session with a left indicator bar, and a uniform 150ms interaction cadence.
 */

const BRAND_A = "#6366f1";
const BRAND_B = "#8b5cf6";
const RING = "0 0 0 2px rgba(99,102,241,0.4)";

/**
 * Truncated-with-ellipsis text that reveals its full content while hovered:
 * on mouseenter the content is doubled (with a gap) and translated in a
 * single-direction seamless loop (-50% = one copy); un-hover restores the
 * ellipsis view. Sibling elements (time, icons) are never covered — the
 * outer span keeps overflow:hidden. Used for sidebar session/project names.
 */
function Marquee({ text, style }: { text: string; style?: CSSProperties }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const [looping, setLooping] = useState(false);
  // Single text copy's layout width — the loop travels textW + GAP per cycle,
  // so duration = (textW + GAP) / SPEED keeps px/s identical across rows.
  const textWRef = useRef(0);
  const GAP = 32;
  const SPEED = 30; // px per second, same for every row
  return (
    <span
      ref={ref}
      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0, ...style }}
      onMouseEnter={() => {
        // Wait a frame: hovering may widen this span (e.g. the row's time
        // label hides via CSS), so measure only after layout settles.
        requestAnimationFrame(() => {
          const outer = ref.current;
          const inner = outer?.firstChild as HTMLElement | null;
          if (!outer || !inner) return;
          const textW = inner.offsetWidth;
          textWRef.current = textW;
          if (textW - outer.clientWidth > 2) setLooping(true);
        });
      }}
      onMouseLeave={() => setLooping(false)}
    >
      {looping ? (
        <span
          style={{
            display: "inline-block", whiteSpace: "nowrap",
            // constant px/s across all rows: duration ∝ loop distance
            animation: `vagus-marquee ${((textWRef.current + GAP) / SPEED).toFixed(2)}s linear infinite`,
          }}
        >
          <span style={{ paddingRight: GAP }}>{text}</span>
          <span style={{ paddingRight: GAP }}>{text}</span>
        </span>
      ) : (
        <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>{text}</span>
      )}
    </span>
  );
}

interface SessionSidebarProps {
  sessions: SessionHistoryItem[];
  activePath?: string;
  onNewSession: () => void;
  onOpenSession: (path: string) => void;
  onOpenSettings: () => void;
  /** Open the plugin market (full-screen view from the sidebar). */
  onOpenPlugins?: () => void;
  /** Rename a session (path → new name). Returns true on success. */
  onRenameSession?: (path: string, name: string) => void | Promise<void>;
  /** Delete a session (path). Returns true on success. */
  onDeleteSession?: (path: string) => void | Promise<void>;
  /** Archive a session (moves its file into the archive). */
  onArchiveSession?: (path: string) => void | Promise<void>;
  /** Restore an archived session back into the active tree. */
  onRestoreSession?: (path: string) => void | Promise<void>;
  /** Permanently delete an archived session file. */
  onDeleteArchivedSession?: (path: string) => void | Promise<void>;
  /** Pin/unpin a session (path). */
  onTogglePin?: (path: string) => void | Promise<void>;
  /** Set of pinned session paths. */
  pinnedSessions?: Set<string>;
  /** Archived projects (cwd + sessions), hidden from the active tree. */
  archivedProjects?: Array<{ cwd: string; dirKey: string; sessions: SessionHistoryItem[] }>;
  /** Archive a project (moves it to the archived section). */
  onArchiveProject?: (cwd: string) => void | Promise<void>;
  /** Restore an archived project back to the active tree. */
  onUnarchiveProject?: (cwd: string) => void | Promise<void>;
  /** Permanently delete an archived project and all its sessions. */
  onDeleteProject?: (cwd: string) => void | Promise<void>;
  /** Session-file paths whose agent is currently running (busy indicator). */
  busyPaths?: Set<string>;
  /** Session-file paths that have a pending ctx.ui dialog awaiting a response. */
  pendingDialogPaths?: Set<string>;
  /** Notified when the sidebar collapses/expands (host may widen the chat pane). */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Permanently delete ALL archived projects (confirm handled inside host). */
  onClearAllArchived?: () => void;
}

export function SessionSidebar({
  sessions,
  activePath,
  onNewSession,
  onOpenSession,
  onOpenSettings,
  onOpenPlugins,
  onRenameSession,
  onDeleteSession,
  onArchiveSession,
  onClearAllArchived,
  onCollapsedChange,
  onRestoreSession,
  onDeleteArchivedSession,
  onTogglePin,
  pinnedSessions = new Set(),
  archivedProjects = [],
  onArchiveProject,
  onUnarchiveProject,
  onDeleteProject,
  busyPaths = new Set(),
  pendingDialogPaths = new Set(),
}: SessionSidebarProps): JSX.Element {
  const t = useTokens();
  const { theme } = useTheme();
  // Collapsed project folders — persisted in localStorage so expansion state
  // survives page refreshes AND daemon restarts (browser-side, zero backend).
  const COLLAPSED_KEY = "vagus.sidebar.collapsedProjects";
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  /** Context menu state: session / project / archived-project. */
  const [menu, setMenu] = useState<
    | { x: number; y: number; kind: "session"; session: SessionHistoryItem; archived?: boolean }
    | { x: number; y: number; kind: "project"; cwd: string }
    | { x: number; y: number; kind: "archived"; cwd: string; dirKey: string }
    | { x: number; y: number; kind: "archivedAll" }
    | null
  >(null);
  /** Session currently being renamed (path). */
  const [renamingPath, setRenamingPath] = useState<string | undefined>();
  const [renameDraft, setRenameDraft] = useState("");
  // Group sessions by cwd; pinned sessions float to the top of each group.
  // Archived sessions are physically moved out of `sessions/` by the daemon,
  // so `sessions` (from listHistory) already excludes them — no extra filter.
  const groups = useMemo(() => {
    const map = new Map<string, SessionHistoryItem[]>();
    for (const s of sessions) {
      const list = map.get(s.cwd) ?? [];
      list.push(s);
      map.set(s.cwd, list);
    }
    return [...map.entries()].toSorted((a, b) => b[1][0]!.modified.localeCompare(a[1][0]!.modified)).map(([cwd, list]) => [
      cwd,
      list.toSorted((x, y) => Number(pinnedSessions.has(y.path)) - Number(pinnedSessions.has(x.path)) || y.modified.localeCompare(x.modified)),
    ] as [string, SessionHistoryItem[]]);
  }, [sessions, pinnedSessions]);

  const toggleProject = (key: string): void => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch { /* private mode — skip persistence */ }
      return next;
    });
  };

  // Right-click on a session opens the context menu (archived = in archive).
  const onContextMenu = (e: React.MouseEvent, session: SessionHistoryItem, archived = false): void => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, kind: "session", session, archived });
  };

  // Right-click on a project row → archive menu.
  const onProjectContextMenu = (e: React.MouseEvent, cwd: string): void => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, kind: "project", cwd });
  };

  const closeMenu = (): void => setMenu(null);

  // Close the context menu only when clicking outside it (or pressing Esc).
  // Moving the mouse away does NOT close it. Note: no document-level
  // `contextmenu` handler here — a right-click that opens a new menu would
  // bubble to it and instantly close the just-opened menu.
  useEffect(() => {
    if (!menu) return;
    const onDocClick = (e: MouseEvent): void => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-context-menu]")) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const handleRename = (session: SessionHistoryItem): void => {
    setRenamingPath(session.path);
    setRenameDraft(session.name ?? session.firstMessage.slice(0, 40));
    setMenu(null);
  };

  /** Menu item styles (shared by session / project / archived menus). */
  const menuItemStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7,
    cursor: "pointer", userSelect: "none", fontSize: "0.89em", color: t.color.fg,
    transition: "background 0.15s",
  };

  const commitRename = (path: string): void => {
    const name = renameDraft.trim();
    setRenamingPath(undefined);
    if (name && onRenameSession) void onRenameSession(path, name);
  };

  // Determine current project from active session
  const activeSession = sessions.find((s) => s.path === activePath);
  const currentCwd = activeSession?.cwd;

  const SIDEBAR_W = 280;
  const SIDEBAR_W_COLLAPSED = 48;
  // Sidebar collapse state — collapsed shows a narrow rail with icon-only
  // buttons (new chat / plugins / settings) and an expand chevron.
  // Persisted in localStorage: survives refreshes and daemon restarts.
  const SIDEBAR_COLLAPSED_KEY = "vagus.sidebar.collapsed";
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setCollapsed = (v: boolean): void => {
    setCollapsedState(v);
    onCollapsedChange?.(v);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? "1" : "0");
    } catch { /* private mode — skip persistence */ }
  };
  /** Indigo tint for the active row (alpha differs per theme). */
  const tint = theme === "light" ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.16)";
  /** Primary action button — brand gradient, used for 新对话. */
  const mainBtnStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8,
    height: 40, padding: "0 14px", borderRadius: 12,
    background: `linear-gradient(135deg, ${BRAND_A}, ${BRAND_B})`,
    border: "none", color: "#fff",
    fontSize: "0.96em", fontWeight: 600, cursor: "pointer", userSelect: "none",
    transition: "filter 0.15s, box-shadow 0.15s, transform 0.15s",
    boxShadow: "0 2px 10px rgba(99,102,241,0.35)",
    width: "100%", outline: "none",
  };

  return (
    <aside style={{
      width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W, flexShrink: 0,
      borderRight: `1px solid ${t.color.border}`,
      background: t.color.sidebarBg,
      display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
      position: "relative",
      transition: "width 0.18s ease",
    }}>
      {collapsed ? (
        <>
          {/* Collapsed rail: expand button on top, then icon-only actions */}
          <div style={{ flex: "none", height: 54, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: `1px solid ${t.color.border}` }}>
            <button
              title="展开侧栏"
              onClick={() => setCollapsed(false)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent", color: t.color.muted, cursor: "pointer", transition: ROW_TRANSITION, outline: "none" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; (e.currentTarget as HTMLElement).style.color = t.color.fg; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = t.color.muted; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
          <div style={{ flex: "none", padding: "14px 8px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <button title="新对话" onClick={onNewSession}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 9, border: "none", cursor: "pointer", outline: "none", background: `linear-gradient(135deg, ${BRAND_A}, ${BRAND_B})`, color: "#fff", boxShadow: "0 2px 10px rgba(99,102,241,0.35)" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            </button>
            <button title="插件" onClick={onOpenPlugins}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 9, border: "none", background: "transparent", color: t.color.muted, cursor: "pointer", transition: ROW_TRANSITION, outline: "none" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; (e.currentTarget as HTMLElement).style.color = t.color.fg; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = t.color.muted; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-3 3a5 5 0 0 0-.5 7.5z"/><path d="M14 10a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l3-3a5 5 0 0 0 .5-7.5z"/></svg>
            </button>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ flex: "none", borderTop: `1px solid ${t.color.border}`, padding: 8, display: "flex", justifyContent: "center" }}>
            <button title="设置" onClick={onOpenSettings}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 9, border: "none", background: "transparent", color: t.color.muted, cursor: "pointer", transition: ROW_TRANSITION, outline: "none" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; (e.currentTarget as HTMLElement).style.color = t.color.fg; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = t.color.muted; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </>
      ) : (
        <>
      {/* Brand —— 固定高 54，底部横线与中间栏/第三栏对齐成一根 */}
      <div style={{ flex: "none", height: 54, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", borderBottom: `1px solid ${t.color.border}` }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: `linear-gradient(135deg,${BRAND_A},${BRAND_B})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.93em", fontWeight: 700, flexShrink: 0, boxShadow: "0 2px 6px rgba(99,102,241,0.4)" }}>◈</span>
        <span style={{ fontSize: "1.05em", fontWeight: 700, color: t.color.fg }}>vagusPI</span>
        <span style={{ flex: 1 }} />
        <button
          title="收起侧栏"
          onClick={() => setCollapsed(true)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: t.color.muted, cursor: "pointer", transition: ROW_TRANSITION, outline: "none", flexShrink: 0 }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; (e.currentTarget as HTMLElement).style.color = t.color.fg; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = t.color.muted; }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>

      {/* 新对话（主按钮）+ 插件（占位） */}
      <div style={{ flex: "none", padding: "14px 16px 4px", display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          style={mainBtnStyle}
          onClick={onNewSession}
          onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.08)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(99,102,241,0.45)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; e.currentTarget.style.boxShadow = "0 2px 10px rgba(99,102,241,0.35)"; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.98)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
          onFocus={(e) => { e.currentTarget.style.boxShadow = `${RING}, 0 2px 10px rgba(99,102,241,0.35)`; }}
          onBlur={(e) => { e.currentTarget.style.boxShadow = "0 2px 10px rgba(99,102,241,0.35)"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          <span style={{ flex: 1, textAlign: "left" }}>新对话</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/></svg>
        </button>
        <button
          onClick={onOpenPlugins}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; (e.currentTarget as HTMLElement).style.color = t.color.fg; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = t.color.muted; }}
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", width: "100%",
            border: "none", background: "transparent", borderRadius: 8, cursor: "pointer", userSelect: "none",
            fontSize: "0.93em", color: t.color.muted, transition: ROW_TRANSITION, outline: "none",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-3 3a5 5 0 0 0-.5 7.5z"/><path d="M14 10a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l3-3a5 5 0 0 0 .5-7.5z"/></svg>
          <span style={{ flex: 1, textAlign: "left" }}>插件</span>
        </button>
      </div>

      {/* Project tree (scrollable) */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 8px 8px" }}>
        <div style={{ fontSize: "0.79em", fontWeight: 600, color: t.color.muted, textTransform: "uppercase", letterSpacing: "0.08em", padding: "12px 10px 6px" }}>项目</div>

        {groups.length === 0 && (
          <div style={{ fontSize: "0.85em", color: t.color.muted, padding: "8px 10px", lineHeight: 1.5 }}>
            暂无会话 — 点击"新对话"开始。
          </div>
        )}

        {groups.map(([cwd, groupSessions]) => {
          const isOpen = !collapsedProjects.has(cwd);
          const isActive = currentCwd === cwd;
          return (
            <div key={cwd} style={{ marginBottom: 2 }}>
              <div
                onClick={() => toggleProject(cwd)}
                onContextMenu={(e) => onProjectContextMenu(e, cwd)}
                style={{
                  position: "relative",
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 8px", borderRadius: 8, cursor: "pointer", userSelect: "none",
                  fontSize: "0.96em", fontWeight: 500, color: t.color.fg,
                  background: isActive ? t.color.sidebarHover : "transparent",
                  transition: ROW_TRANSITION,
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                {isActive && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: `linear-gradient(180deg,${BRAND_A},${BRAND_B})` }} />}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0, color: isActive ? BRAND_A : t.color.muted }}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
                <Marquee text={projectName(cwd)} style={{ flex: 1 }} />
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, color: t.color.muted, transform: isOpen ? "rotate(0)" : "rotate(-90deg)", transition: "transform 0.15s ease" }}><path d="M9 18l6-6-6-6"/></svg>
              </div>
              {collapsible(isOpen, (
                <div style={{ paddingLeft: 30 }}>
                  {groupSessions.map((s) => {
                    const active = s.path === activePath;
                    const renaming = renamingPath === s.path;
                    return (
                      <div
                        key={s.id}
                        className="vagus-session-row"
                        onClick={() => onOpenSession(s.path)}
                        onContextMenu={(e) => onContextMenu(e, s)}
                        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; }}
                        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        style={{
                          position: "relative",
                          display: "flex", alignItems: "center", gap: 7,
                          padding: "6px 10px", borderRadius: 10, cursor: "pointer", userSelect: "none",
                          fontSize: "0.91em", color: active ? t.color.fg : t.color.muted,
                          fontWeight: active ? 500 : 400,
                          background: active ? tint : "transparent",
                          overflow: "hidden", whiteSpace: "nowrap",
                          transition: ROW_TRANSITION,
                        }}
                      >
                        {active && <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 3, background: `linear-gradient(180deg,${BRAND_A},${BRAND_B})` }} />}
                        <BubbleIcon color={active ? BRAND_A : undefined} />
                        {renaming ? (
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onBlur={(e) => { e.currentTarget.style.boxShadow = "none"; commitRename(s.path); }}
                            onKeyDown={(e) => { if (e.key === "Enter") commitRename(s.path); if (e.key === "Escape") setRenamingPath(undefined); }}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={(e) => { e.currentTarget.style.boxShadow = RING; }}
                            style={{
                              flex: 1, minWidth: 0, fontSize: "0.89em", padding: "2px 6px",
                              background: t.color.bg, border: `1px solid ${t.color.border}`,
                              borderRadius: 6, color: t.color.fg, outline: "none",
                            }}
                          />
                        ) : (
                          <Marquee text={(s.name ?? s.firstMessage.slice(0, 40)) || "（空会话）"} />
                        )}
                        <span style={{ width: 14, display: "inline-flex", justifyContent: "center", alignItems: "center", flexShrink: 0 }}>
                          {pinnedSessions.has(s.path) && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: BRAND_A }}><path d="M12 17l-5.88 3.09.87-6.02L2.6 9.43l6.44-.94L12 2.5l2.96 5.99 6.44.94-4.39 4.64.87 6.02z"/></svg>
                          )}
                        </span>
                        <span style={{ width: 12, display: "inline-flex", justifyContent: "center", alignItems: "center", flexShrink: 0 }}>
                          {(busyPaths.has(s.path) || pendingDialogPaths.has(s.path)) && (
                            <span title="工作中" style={{ width: 7, height: 7, borderRadius: "50%", background: t.color.primary, animation: "vagus-pulse 1.2s ease-in-out infinite", display: "inline-block" }} />
                          )}
                        </span>

                        <span className="vagus-row-time" style={{ fontSize: "0.79em", color: t.color.muted, flexShrink: 0 }}>{timeAgo(s.modified)}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })}

        {/* 最近 */}
        {groups.length > 0 && (
          <>
            <div style={{ fontSize: "0.79em", fontWeight: 600, color: t.color.muted, textTransform: "uppercase", letterSpacing: "0.08em", padding: "16px 10px 6px" }}>最近</div>
            <div style={{ paddingLeft: 0 }}>
              {sessions.slice(0, 5).map((s) => (
                <div
                  key={s.id}
                  onClick={() => onOpenSession(s.path)}
                  onContextMenu={(e) => onContextMenu(e, s)}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "6px 10px", borderRadius: 10, cursor: "pointer", userSelect: "none",
                    fontSize: "0.91em", color: t.color.muted, overflow: "hidden", whiteSpace: "nowrap",
                    transition: ROW_TRANSITION,
                  }}
                >
                  <BubbleIcon />
                  <Marquee text={s.name ?? s.firstMessage.slice(0, 40)} />
                </div>
              ))}
            </div>
          </>
        )}

        <ArchiveSection
          archivedProjects={archivedProjects}
          busyPaths={busyPaths}
          collapsed={collapsedProjects}
          onToggleProject={toggleProject}
          onOpenSession={onOpenSession}
          onSessionContextMenu={(e, s, a) => onContextMenu(e, s, a)}
          onProjectContextMenu={(e, cwd, dirKey) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind: "archived", cwd, dirKey }); }}
          onSectionContextMenu={(e) => setMenu({ x: e.clientX, y: e.clientY, kind: "archivedAll" })}
        />
      </div>

      {/* 设置（固定底部） */}
      <div style={{ flex: "none", borderTop: `1px solid ${t.color.border}`, padding: 8, background: t.color.sidebarBg }}>
        <button
          onClick={onOpenSettings}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover; (e.currentTarget as HTMLElement).style.color = t.color.fg; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = t.color.muted; }}
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", width: "100%",
            border: "none", background: "transparent", borderRadius: 8, cursor: "pointer", userSelect: "none",
            fontSize: "0.93em", color: t.color.muted, transition: ROW_TRANSITION,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>设置</span>
        </button>
      </div>

      {/* Context menu — session / project / archived */}
      {menu && (
        <div data-context-menu
          style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 1000, minWidth: 140,
            background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.2)", padding: 4 }}
        >
          {menu.kind === "session" && !menu.archived && (
            <>
              <div onClick={() => handleRename(menu.session)} style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4z"/></svg>
                重命名
              </div>
              {onTogglePin && (
                <div onClick={() => { setMenu(null); void onTogglePin(menu.session.path); }} style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={pinnedSessions.has(menu.session.path) ? "#6366f1" : "none"} stroke={pinnedSessions.has(menu.session.path) ? "#6366f1" : "currentColor"} strokeWidth="1.6"><path d="M12 17l-5.88 3.09.87-6.02L2.6 9.43l6.44-.94L12 2.5l2.96 5.99 6.44.94-4.39 4.64.87 6.02z"/></svg>
                  置顶
                </div>
              )}
              {onArchiveSession && (
                <div onClick={() => { setMenu(null); void onArchiveSession(menu.session.path); }} style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 8l-2-4H5L3 8v2h18V8z"/><path d="M3 10v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/></svg>
                  归档
                </div>
              )}
            </>
          )}
          {menu.kind === "session" && menu.archived && (
            <>
              {onRestoreSession && (
                <div onClick={() => { setMenu(null); void onRestoreSession(menu.session.path); }} style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  恢复
                </div>
              )}
              {onDeleteArchivedSession && (
                <div onClick={() => { setMenu(null); void onDeleteArchivedSession(menu.session.path); }} style={{...menuItemStyle, color: "#E5484D"}} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  删除
                </div>
              )}
            </>
          )}
          {menu.kind === "project" && onArchiveProject && (
            <div onClick={() => { setMenu(null); void onArchiveProject(menu.cwd); }} style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 8l-2-4H5L3 8v2h18V8z"/><path d="M3 10v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/></svg>
              归档项目
            </div>
          )}
          {menu.kind === "archivedAll" && (
            <div onClick={() => { setMenu(null); onClearAllArchived?.(); }} style={{...menuItemStyle, color: "#E5484D"}} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
              清空全部归档
            </div>
          )}
          {menu.kind === "archived" && (
            <>
              {onUnarchiveProject && (
                <div onClick={() => { setMenu(null); void onUnarchiveProject(menu.dirKey); }} style={menuItemStyle} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 8l-2-4H5L3 8v2h18V8z"/><path d="M3 10v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8"/><path d="M12 13v3"/></svg>
                  恢复项目
                </div>
              )}
              {onDeleteProject && (
                <div onClick={() => { setMenu(null); void onDeleteProject(menu.dirKey); }} style={{...menuItemStyle, color: "#E5484D"}} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = t.color.sidebarHover} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                  彻底删除
                </div>
              )}
            </>
          )}
        </div>
      )}
        </>
      )}
    </aside>
  );
}
