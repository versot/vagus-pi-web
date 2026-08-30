import { useTokens } from "@vagus/ui-tokens";

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/** Custom confirmation dialog (replaces window.confirm for dangerous deletes). */
export function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: () => void }): JSX.Element {
  const t = useTokens();
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 380, maxWidth: "calc(100vw - 48px)",
        background: t.color.surface, border: `1px solid ${t.color.border}`,
        borderRadius: 16, padding: "20px 22px",
        boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: "1.02em", fontWeight: 600, color: "#E5484D" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          {state.title}
        </div>
        <div style={{ fontSize: "0.92em", color: t.color.muted, margin: "12px 0 22px", lineHeight: 1.6 }}>
          {state.message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              height: 34, padding: "0 16px", borderRadius: 9, border: `1px solid ${t.color.border}`,
              background: "transparent", color: t.color.fg, fontSize: "0.9em", cursor: "pointer", fontFamily: "inherit",
            }}
          >取消</button>
          <button
            onClick={() => { const fn = state.onConfirm; onClose(); fn(); }}
            style={{
              height: 34, padding: "0 16px", borderRadius: 9, border: "none",
              background: "#E5484D", color: "#fff", fontSize: "0.9em", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              boxShadow: "0 2px 10px rgba(229,72,77,0.35)",
            }}
          >{state.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
