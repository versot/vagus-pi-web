import { useTokens } from "@vagus/ui-tokens";
import type { RightTab } from "./right-panel.js";

/**
 * Widget tab for the right panel — shows extension widgets (ctx.ui.setWidget)
 * like the todo overlay, rendered as fixed text lines (TUI-style).
 */
export const WIDGET_TAB: RightTab = {
  id: "widget",
  label: "面板",
  icon: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 3v18M3 12h18" />
    </svg>
  ),
};

/** Renders all active widgets (key → lines) in the right panel. */
export function WidgetPanelContent({ widgets }: { widgets: Record<string, { lines: string[] }> }): JSX.Element {
  const t = useTokens();
  const entries = Object.entries(widgets).filter(([, w]) => w.lines.length > 0);
  if (entries.length === 0) {
    return <div style={{ padding: "16px 18px", fontSize: "0.86em", color: t.color.muted }}>（没有活动的面板）</div>;
  }
  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10, fontFamily: t.font.mono, fontSize: "0.82em", lineHeight: 1.6, color: t.color.fg }}>
      {entries.map(([key, w]) => (
        <div key={key} style={{ background: t.color.bg, border: `1px solid ${t.color.border}`, borderRadius: 10, padding: "8px 10px" }}>
          {w.lines.map((line, i) => (
            <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{line}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
