import { useState, type CSSProperties } from "react";
import { useTokens } from "@vagus/ui-tokens";

/**
 * Floating status dock (bottom-right): replaces the always-visible
 * above-editor status pills / widget lines. A small chip hints at pending
 * items (count + breathing glow); hovering expands a panel with staggered
 * entries; moving out collapses it again.
 */
export function StatusDock(props: { statuses: Record<string, string>; widgets: Record<string, { lines: string[] }> }) {
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const statusEntries = Object.entries(props.statuses).filter(([, text]) => text.length > 0);
  const widgetEntries = Object.entries(props.widgets).filter(([, w]) => w.lines.length > 0);
  if (statusEntries.length === 0 && widgetEntries.length === 0) return null;

  const panelStyle = (i: number): CSSProperties => ({
    opacity: open ? 1 : 0,
    transform: open ? "translateY(0) scale(1)" : "translateY(7px) scale(0.97)",
    transition: `opacity 0.24s ease ${open ? 70 + i * 45 : 0}ms, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1) ${open ? 70 + i * 45 : 0}ms`,
  });

  let idx = 0;
  return (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Panel: sits above the chip; wrapper keeps a continuous hover area */}
      <div style={{ position: "absolute", bottom: "calc(100% + 12px)", left: 0, zIndex: 60, display: "flex", flexDirection: "column", alignItems: "stretch", pointerEvents: open ? "auto" : "none" }}>
        <div
          style={{
            minWidth: 300, maxWidth: 480, maxHeight: "52vh", overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 8, padding: 11,
            background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: 14,
            boxShadow: "0 14px 44px rgba(0,0,0,0.28)",
            opacity: open ? 1 : 0, transform: open ? "translateY(0) scale(1)" : "translateY(10px) scale(0.94)",
            transformOrigin: "bottom left",
            transition: `opacity 0.2s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)`,
          }}
        >
          {statusEntries.map(([key, text]) => {
            const style = panelStyle(idx++);
            return (
              <div key={`s-${key}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 11px", borderRadius: 999, background: t.color.bg, border: `1px solid ${t.color.border}`, fontSize: "0.82em", ...style }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: t.color.primary }} />
                <span style={{ color: t.color.muted, fontWeight: 600, flexShrink: 0 }}>{key}</span>
                <span style={{ color: t.color.fg, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</span>
              </div>
            );
          })}
          {widgetEntries.map(([key, w]) => {
            const style = panelStyle(idx++);
            return (
              <div key={`w-${key}`} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "7px 11px", borderRadius: 10, background: t.color.bg, border: `1px solid ${t.color.border}`, fontSize: "0.82em", ...style }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: t.color.muted, fontWeight: 600 }}>
                  <span style={{ color: t.color.primary }}>▦</span> {key}
                </span>
                {w.lines.map((line, i) => (
                  <span key={i} style={{ color: t.color.fg, whiteSpace: "pre-wrap", wordBreak: "break-word", paddingLeft: 14 }}>{line}</span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {/* Trigger chip: breathing glow while items exist */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", borderRadius: 999,
          background: t.color.surface, border: `1px solid ${open ? t.color.primary : t.color.border}`,
          color: t.color.primary, cursor: "default", fontSize: "0.8em", fontWeight: 600,
          opacity: open ? 1 : 0.72,
          boxShadow: open ? "0 6px 20px rgba(0,0,0,0.22)" : "none",
          animation: open ? "none" : "vagus-dock-pulse 2.6s ease-in-out infinite",
          transition: "opacity 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
        }}
      >
        {statusEntries.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
            {statusEntries.length}
          </span>
        )}
        {widgetEntries.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: "0.9em" }}>▦</span>
            {widgetEntries.length}
          </span>
        )}
      </div>
    </div>
  );
}
