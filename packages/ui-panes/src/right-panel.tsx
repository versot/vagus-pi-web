import { useRef, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";

/**
 * Right-pane tab container — macOS-style minimal browser tab bar.
 *
 * Each tab is a small rounded capsule (current = light-gray fill + dark
 * label, others = transparent + muted label) with its OWN ✕ close button.
 * Tabs sit on a clean low-contrast bar with the fold control at the far
 * right. The content area renders the active tab's view.
 */

export interface RightTab {
  id: string;
  label: string;
  /** Small linear icon (document / globe / …) shown before the label. */
  icon?: React.ReactNode;
}

export function RightPanel(props: {
  tabs: RightTab[];
  activeId?: string;
  collapsed: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onToggleCollapse: () => void;
  /** Render the active tab's content. */
  render: (tab: RightTab) => React.ReactNode;
  /** Expanded panel width in px. */
  width?: number;
  /** Called while dragging the left-edge handle (new width in px). */
  onWidthChange?: (w: number) => void;
}): JSX.Element | null {
  const t = useTokens();
  const { tabs, activeId, collapsed, onActivate, onClose, onToggleCollapse, render, width = 380, onWidthChange } = props;
  const COLLAPSED_W = 14; // matches the expanded panel's right-edge grip width
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const startDrag = (e: React.MouseEvent): void => {
    if (collapsed) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    setDragging(true);
    const onMove = (ev: MouseEvent): void => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - ev.clientX; // drag left → wider
      const w = Math.min(900, Math.max(260, dragRef.current.startW + delta));
      onWidthChange?.(w);
    };
    const onUp = (): void => {
      dragRef.current = null;
      setDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const active = tabs.find((x) => x.id === activeId) ?? tabs[0] ?? null;

  return (
    <aside
      style={{
        width: collapsed ? COLLAPSED_W : width,
        flexShrink: 0, minWidth: 0,
        borderLeft: `1px solid ${t.color.border}`,
        background: t.color.bg,
        display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
        transition: "width 0.3s cubic-bezier(0.25, 1, 0.5, 1)",
      }}
    >
      {collapsed ? (
        /* ── 折叠态：浅色窄条 ────────────────────────────────── */
        <div
          onClick={onToggleCollapse}
          title="展开右侧面板"
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", userSelect: "none",
            background: t.color.surface,
            color: "#6366f1",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,102,241,0.1)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = t.color.surface; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </div>
      ) : (
        /* ── 展开态 ──────────────────────────────────────────── */
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* 左边缘拖拽手柄：调宽度 */}
          <div
            onMouseDown={startDrag}
            title="拖动调整宽度"
            style={{
              width: 4, flexShrink: 0, cursor: "col-resize",
              background: dragging ? "rgba(99,102,241,0.25)" : "transparent",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,102,241,0.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = dragging ? "rgba(99,102,241,0.25)" : "transparent"; }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
            {/* macOS 风格标签栏 —— 高 54，底部横线与侧栏/中间栏对齐 */}
            <div
              style={{
                display: "flex", alignItems: "center", gap: 2,
                padding: "0 6px",
                background: t.color.bg,
                borderBottom: `1px solid ${t.color.border}`,
                flexShrink: 0, height: 54, overflowX: "auto", scrollbarWidth: "none",
              }}
            >
              {tabs.map((tab) => {
                const isActive = active !== null && tab.id === active.id;
                return (
                  <div
                    key={tab.id}
                    onClick={() => onActivate(tab.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      height: 36, padding: "0 14px 0 20px",
                      borderRadius: 9,
                      background: isActive ? t.color.surface : "transparent",
                      cursor: "pointer", userSelect: "none", flexShrink: 0,
                      maxWidth: 220,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = t.color.surface; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                  >
                    {tab.icon}
                    <span
                      style={{
                        fontSize: "0.9em", fontWeight: isActive ? 600 : 500,
                        color: isActive ? t.color.fg : t.color.muted,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}
                    >
                      {tab.label}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                      title={`关闭 ${tab.label}`}
                      style={{
                        width: 17, height: 17, borderRadius: 5, border: "none",
                        background: "transparent", color: t.color.muted,
                        cursor: "pointer", display: "flex", alignItems: "center",
                        justifyContent: "center", padding: 0, fontFamily: "inherit",
                        opacity: isActive ? 0.85 : 0.45,
                        transition: "background 0.15s, color 0.15s, opacity 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = t.color.sidebarHover; e.currentTarget.style.color = t.color.fg; e.currentTarget.style.opacity = "1"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.color.muted; e.currentTarget.style.opacity = isActive ? "0.8" : "0.4"; }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}

              {/* 标签栏右侧留空 — 折叠由右边缘竖栏抓手完成 */}
              <div style={{ flex: 1 }} />
            </div>

            {/* 内容区 */}
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: t.color.bg }}>
              {active ? (
                render(active)
              ) : (
                /* 无标签（会话无编辑）：空面板，无文案 */
                <div style={{ height: "100%" }} />
              )}
            </div>
          </div>

          {/* 右边缘竖栏抓手：始终可见，点击折叠 */}
          <div
            onClick={onToggleCollapse}
            title="收起右侧面板"
            style={{
              width: 14, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: t.color.surface,
              borderLeft: `1px solid ${t.color.border}`,
              cursor: "pointer", userSelect: "none",
              color: t.color.muted,
              transition: "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,102,241,0.12)"; e.currentTarget.style.color = "#6366f1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.color.surface; e.currentTarget.style.color = t.color.muted; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </div>
      )}
    </aside>
  );
}