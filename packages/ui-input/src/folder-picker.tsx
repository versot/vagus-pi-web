import { useEffect, useMemo, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";

/**
 * In-app folder picker (modal) — system-dialog style (Windows file dialog
 * layout): left quick-access rail (Places / Drives / Recent), address bar
 * with editable breadcrumbs, icon grid, footer actions.
 *
 * Browsing goes through daemon RPCs (`project.roots` / `project.listDir`)
 * because the browser sandbox never hands real filesystem paths to a page.
 */

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface ListDirResult {
  path: string;
  entries: DirEntry[];
}

interface FolderPickerProps {
  /** List a directory. */
  listDir: (dir: string) => Promise<ListDirResult>;
  /** Quick-access roots: { places, drives }. */
  roots: () => Promise<{ places: DirEntry[]; drives: DirEntry[] }>;
  /** Called with the chosen folder path (null = cancelled). */
  onPick: (path: string | null) => void;
}

const LAST_DIR_KEY = "vagus.picker.lastDir";
const RECENT_KEY = "vagus.picker.recent";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return list.slice(0, 8);
  } catch {
    return [];
  }
}

function rememberRecent(path: string): void {
  try {
    const list = loadRecent().filter((p) => p !== path);
    list.unshift(path);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
    localStorage.setItem(LAST_DIR_KEY, path);
  } catch {
    // localStorage unavailable — ignore
  }
}

const FOLDER_ICONS: Record<string, string> = {
  Desktop: "🖥️",
  Downloads: "📥",
  Documents: "📄",
  Pictures: "🖼️",
  Music: "🎵",
  Videos: "🎬",
  Home: "🏠",
  Root: "💿",
};

export function FolderPicker({ listDir, roots, onPick }: FolderPickerProps): JSX.Element {
  const t = useTokens();
  const [currentPath, setCurrentPath] = useState<string>(() => {
    const last = localStorage.getItem(LAST_DIR_KEY);
    return last && last.length > 0 ? last : "~";
  });
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [quickRoots, setQuickRoots] = useState<{ places: DirEntry[]; drives: DirEntry[] }>({ places: [], drives: [] });
  const [recent] = useState<string[]>(loadRecent);

  // Load quick-access roots once.
  useEffect(() => {
    void roots().then((r) => setQuickRoots(r)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browse whenever the path changes.
  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelected(null);
    void listDir(currentPath)
      .then((data) => {
        setCurrentPath(data.path);
        setEntries(data.entries);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Enter selects current folder, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter" && !editingPath) handleSelect();
      if (e.key === "Escape") onPick(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPath, currentPath]);

  const isWinPath = /^[A-Za-z]:[\\/]/.test(currentPath);
  const segments = useMemo(() => currentPath.split(/[\\/]+/).filter(Boolean), [currentPath]);

  function crumbPath(i: number): string {
    if (isWinPath) {
      const first = segments[0]!;
      if (i === 0) return `${first}\\`;
      return `${first}\\${segments.slice(1, i + 1).join("\\")}`;
    }
    return `/${segments.slice(0, i + 1).join("/")}`;
  }

  function upPathOf(p: string): string {
    if (/^[A-Za-z]:[\\/]?$/.test(p)) return p; // drive root, no parent
    const up = p.replace(/[\\/][^\\/]+$/, "");
    if (up.length === 0) return "/";
    if (isWinPath && up.length === 2 && up.endsWith(":")) return `${up}\\`;
    return up;
  }

  function navigate(path: string): void {
    setEditingPath(false);
    setCurrentPath(path);
  }

  function handleSelect(): void {
    // Prefer the clicked/selected folder; fall back to the current directory.
    const chosen = selected ?? currentPath;
    if (!chosen) return;
    rememberRecent(chosen);
    onPick(chosen);
  }

  function handlePathSubmit(): void {
    const trimmed = pathDraft.trim();
    if (trimmed) navigate(trimmed);
    else setEditingPath(false);
  }

  const upPath = upPathOf(currentPath);
  const atRoot = upPath === currentPath;

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 500,
    background: "rgba(0,0,0,0.35)",
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const card: React.CSSProperties = {
    width: 640, maxHeight: "72vh", background: t.color.bg,
    border: `1px solid ${t.color.border}`, borderRadius: 16,
    boxShadow: "0 24px 64px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", overflow: "hidden",
  };
  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent",
    color: t.color.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  };

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onPick(null); }}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 8px", flexShrink: 0 }}>
          <span style={{ fontSize: "0.96em", fontWeight: 600, color: t.color.fg }}>选择项目文件夹</span>
          <button style={iconBtn} onClick={() => onPick(null)} title="关闭">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Address bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px 10px", flexShrink: 0 }}>
          <button style={{ ...iconBtn, opacity: atRoot ? 0.35 : 1, cursor: atRoot ? "default" : "pointer" }} disabled={atRoot} onClick={() => navigate(upPath)} title="上一级">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          {editingPath ? (
            <form style={{ flex: 1, display: "flex" }} onSubmit={(e) => { e.preventDefault(); handlePathSubmit(); }}>
              <input
                autoFocus
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                onBlur={() => setEditingPath(false)}
                placeholder="输入路径（如 ~/projects/app）"
                style={{ flex: 1, height: 30, border: `1px solid ${t.color.border}`, borderRadius: 8, outline: "none", padding: "0 10px", fontSize: "0.89em", background: t.color.surface, color: t.color.fg, fontFamily: "inherit" }}
              />
            </form>
          ) : (
            <div
              style={{ flex: 1, height: 30, display: "flex", alignItems: "center", gap: 2, padding: "0 10px", borderRadius: 8, background: t.color.surface, border: `1px solid ${t.color.border}`, fontSize: "0.89em", color: t.color.fg, cursor: "text", overflow: "hidden", whiteSpace: "nowrap" }}
              onClick={() => { setPathDraft(currentPath); setEditingPath(true); }}
              title={currentPath}
            >
              <span style={{ color: t.color.muted, flexShrink: 0 }}>{isWinPath ? segments[0] : "/"}</span>
              {segments.slice(isWinPath ? 1 : 0).map((seg, i) => {
                const realIndex = isWinPath ? i + 1 : i;
                const isCurrent = realIndex === segments.length - 1;
                return (
                  <span key={`${seg}-${i}`} style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    <span style={{ color: t.color.muted, fontSize: "0.71em" }}>▸</span>
                    <span
                      style={{ color: isCurrent ? t.color.fg : t.color.muted, fontWeight: isCurrent ? 500 : 400, cursor: isCurrent ? "default" : "pointer", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}
                      onClick={(e) => {
                        if (isCurrent) return;
                        e.stopPropagation();
                        navigate(crumbPath(realIndex));
                      }}
                    >
                      {seg}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0, borderTop: `1px solid ${t.color.border}` }}>
          {/* Quick access rail */}
          <aside style={{ width: 150, flexShrink: 0, borderRight: `1px solid ${t.color.border}`, padding: "6px 4px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "6px 10px 4px", fontSize: "0.75em", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: t.color.muted }}>位置</div>
            {quickRoots.places.map((root) => (
              <button
                key={root.path}
                onClick={() => navigate(root.path)}
                title={root.path}
                style={{
                  display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px",
                  borderRadius: 8, border: "none", background: currentPath === root.path ? t.color.surface : "transparent",
                  cursor: "pointer", fontSize: "0.89em", color: t.color.fg, textAlign: "left", flexShrink: 0,
                }}
              >
                <span style={{ fontSize: "0.93em", flexShrink: 0 }}>{FOLDER_ICONS[root.name] ?? "📁"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{root.name}</span>
              </button>
            ))}
            {quickRoots.drives.length > 0 && (
              <>
                <div style={{ padding: "8px 10px 4px", fontSize: "0.75em", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: t.color.muted }}>驱动器</div>
                {quickRoots.drives.map((drive) => (
                  <button
                    key={drive.path}
                    onClick={() => navigate(drive.path)}
                    title={drive.path}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px",
                      borderRadius: 8, border: "none", background: currentPath === drive.path ? t.color.surface : "transparent",
                      cursor: "pointer", fontSize: "0.89em", color: t.color.fg, textAlign: "left", flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: "0.93em", flexShrink: 0 }}>💽</span>
                    <span>{drive.name}</span>
                  </button>
                ))}
              </>
            )}
            {recent.length > 0 && (
              <>
                <div style={{ padding: "8px 10px 4px", fontSize: "0.75em", fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: t.color.muted }}>最近</div>
                {recent.map((p) => (
                  <button
                    key={p}
                    onClick={() => navigate(p)}
                    title={p}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px",
                      borderRadius: 8, border: "none", background: "transparent",
                      cursor: "pointer", fontSize: "0.89em", color: t.color.fg, textAlign: "left", flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: "0.93em", flexShrink: 0 }}>⭐</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.split(/[\\/]/).filter(Boolean).pop() ?? p}</span>
                  </button>
                ))}
              </>
            )}
          </aside>

          {/* Icon grid */}
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column" }}>
            {loading ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: t.color.muted, fontSize: "0.93em" }}>加载中…</div>
            ) : error ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: "#E5484D", fontSize: "0.93em" }}>{error}</div>
            ) : entries.length === 0 ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: t.color.muted, fontSize: "0.93em" }}>（空文件夹）</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 4 }}>
                {entries.map((entry) => (
                  <div
                    key={entry.path}
                    onClick={() => entry.isDirectory && setSelected(entry.path)}
                    onDoubleClick={() => entry.isDirectory && navigate(entry.path)}
                    title={entry.path}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      padding: "10px 4px", borderRadius: 10, cursor: entry.isDirectory ? "pointer" : "default",
                      background: selected === entry.path ? t.color.surface : "transparent",
                      userSelect: "none", overflow: "hidden",
                    }}
                  >
                    <span style={{ fontSize: 26, lineHeight: 1 }}>{entry.isDirectory ? "📁" : "📄"}</span>
                    <span style={{ fontSize: "0.82em", color: entry.isDirectory ? t.color.fg : t.color.muted, textAlign: "center", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 16px", borderTop: `1px solid ${t.color.border}`, flexShrink: 0 }}>
          <span style={{ fontSize: "0.82em", color: t.color.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={currentPath}>{currentPath}</span>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={() => onPick(null)} style={{ height: 30, padding: "0 16px", borderRadius: 8, border: `1px solid ${t.color.border}`, background: "transparent", color: t.color.muted, fontSize: "0.89em", cursor: "pointer" }}>
              取消
            </button>
            <button onClick={handleSelect} disabled={!currentPath} style={{ height: 30, padding: "0 16px", borderRadius: 8, border: "none", background: "#3A3A3A", color: "#fff", fontSize: "0.89em", cursor: "pointer", fontWeight: 500 }}>
              选择{selected ? ` “${(selected.split(/[\\/]/).filter(Boolean).pop() ?? selected)}”` : "此文件夹"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
