import { useEffect, useRef, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";

/**
 * Project selector — floating pill trigger above the input card.
 *
 * Clicking opens an upward popover listing projects (cwd dirs). Selecting
 * one updates the label. Presentational; the parent owns the project list.
 */

export interface ProjectOption {
  /** Unique id (cwd path). */
  id: string;
  /** Display name. */
  name: string;
  /** Whether this project is usable (e.g. dir exists). */
  available?: boolean;
}

interface ProjectSelectorProps {
  projects: ProjectOption[];
  /** Currently selected project id (undefined = none). */
  value?: string;
  onChange: (id: string) => void;
  onNewProject: () => void;
}

export function ProjectSelector({ projects, value, onChange, onNewProject }: ProjectSelectorProps): JSX.Element {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close the panel on outside mousedown / Esc (same pattern as + menu).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = projects.find((p) => p.id === value);
  // Fallback: when a folder was just picked but its session/history hasn't
  // loaded yet, derive the display name from the path itself.
  const fallbackName = value ? (value.split(/[\\/]/).filter(Boolean).pop() ?? value) : undefined;
  const displayName = selected?.name ?? fallbackName ?? "选择项目";
  const filtered = projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  const hasSelection = value !== undefined;
  const trigger: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6,
    background: hasSelection ? "rgba(99,102,241,0.08)" : t.color.surface,
    color: hasSelection ? "#6366f1" : t.color.muted,
    fontSize: "0.89em", fontWeight: hasSelection ? 600 : 500,
    padding: "6px 10px 6px 8px", borderRadius: 9, cursor: "pointer",
    border: `1px solid ${hasSelection ? "rgba(99,102,241,0.4)" : t.color.border}`,
    marginBottom: -1, zIndex: 2, position: "relative",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  };

  const panel: React.CSSProperties = {
    position: "absolute", bottom: 36, left: 0, zIndex: 20,
    width: 325, height: 275, background: t.color.bg,
    border: `1px solid ${t.color.border}`, borderRadius: 16,
    boxShadow: "0 16px 48px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.05)",
    display: open ? "flex" : "none", flexDirection: "column", overflow: "hidden",
  };

  return (
    <div style={{ position: "relative", alignSelf: "flex-start", zIndex: 10 }}>
      <div
        ref={triggerRef}
        style={trigger}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
        <span>{displayName}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}><path d="M6 9l6 6 6-6"/></svg>
      </div>

      <div ref={panelRef} style={panel} onClick={(e) => e.stopPropagation()}>
        {/* 搜索 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px 8px", flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: t.color.muted }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: "0.93em", color: t.color.fg }}
          />
        </div>

        {/* 列表 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px", minHeight: 0 }}>
          {filtered.map((p) => {
            const isSelected = p.id === value;
            return (
              <div
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px",
                  borderRadius: 9, cursor: "pointer", fontSize: "0.93em", color: t.color.fg,
                  background: isSelected ? t.color.surface : "transparent",
                  opacity: p.available === false ? 0.45 : 1,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, color: t.color.muted }}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              </div>
            );
          })}
        </div>

        {/* 底部操作 */}
        <div style={{ borderTop: `1px solid ${t.color.border}`, flexShrink: 0, padding: 4 }}>
          <button
            onClick={() => { onNewProject(); setOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 36, width: "100%",
              border: "none", background: "transparent", borderRadius: 8, fontSize: "0.93em", color: t.color.fg, cursor: "pointer",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: t.color.muted }}><path d="M12 5v14M5 12h14"/></svg>
            新建项目
          </button>
        </div>
      </div>
    </div>
  );
}