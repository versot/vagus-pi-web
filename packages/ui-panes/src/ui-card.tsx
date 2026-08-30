import { useEffect, useRef, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";

/** The `ui.request` event payload (extension UI bridge, pi RPC-style). */
export interface UiRequestEvent {
  type: "ui.request";
  id: string;
  method: "confirm" | "select" | "input" | "notify" | "setStatus" | "widgetLines";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  timeout?: number | null;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string | null;
  widgetKey?: string;
  lines?: string[];
  placement?: "aboveEditor" | "belowEditor";
  /** Owning session for session-scoped widgets (frontend filters by active session). */
  sessionId?: string;
}

/**
 * Extension UI inline card — renders ctx.ui.confirm/select/input as a card
 * INSIDE the conversation stream (not a modal overlay). The card is a message:
 * it belongs to its session, survives session switches naturally, and needs no
 * overlay/z-index machinery at all.
 */
export interface UiCardItem {
  event: UiRequestEvent;
  /** Owning session (frontend groups cards by session). */
  sessionId?: string;
  /** pending = awaiting user; answered = user chose, shown read-only. */
  status: "pending" | "answered";
  /** The user's answer (kept so the card can be reviewed later). */
  result?: { confirmed?: boolean; value?: string; cancelled?: boolean };
}

const TITLES: Record<string, string> = {
  confirm: "确认",
  select: "请选择",
  input: "输入",
};

export function UiCard({ card, onRespond }: { card: UiCardItem; onRespond: (result: { confirmed?: boolean; value?: string; cancelled?: boolean }) => void }): JSX.Element {
  const t = useTokens();
  const { event } = card;
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (event.method === "input" && card.status === "pending") inputRef.current?.focus();
  }, [event.method, card.status]);

  const answerLabel = card.result
    ? card.result.cancelled ? "已取消"
      : card.result.confirmed ? "已确认"
      : card.result.value ?? ""
    : "";

  const answered = card.status === "answered";

  const btnBase: React.CSSProperties = {
    height: 34, padding: "0 14px", borderRadius: 9, fontSize: "0.9em",
    cursor: answered ? "default" : "pointer", fontFamily: "inherit",
  };

  return (
    <div
      style={{
        maxWidth: 520, margin: "10px 0 6px",
        background: answered ? t.color.bg : t.color.surface,
        border: `1px solid ${answered ? t.color.border : t.color.primary}`,
        borderRadius: 14, padding: "14px 16px",
        boxShadow: answered ? "none" : `0 2px 12px rgba(0,0,0,0.12)`,
      }}
    >
      {/* Header: method badge + title */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: answered ? 8 : 10 }}>
        <span style={{
          fontSize: "0.72em", fontWeight: 700, letterSpacing: "0.04em",
          padding: "2px 8px", borderRadius: 999,
          background: answered ? "transparent" : t.color.primary, color: answered ? t.color.muted : "#fff",
          border: answered ? `1px solid ${t.color.border}` : "none",
        }}>
          {event.method.toUpperCase()}
        </span>
        <span style={{ fontSize: "0.95em", fontWeight: 600, color: t.color.fg }}>
          {event.title ?? TITLES[event.method] ?? event.method}
        </span>
      </div>

      {/* Question / message */}
      {event.message && (
        <div style={{ fontSize: "0.92em", color: t.color.fg, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: answered ? 0 : 12 }}>
          {event.message}
        </div>
      )}

      {answered ? (
        /* Read-only: show the chosen answer so the exchange stays reviewable. */
        <div style={{
          fontSize: "0.88em", color: t.color.muted,
          background: t.color.bg, border: `1px solid ${t.color.border}`,
          borderRadius: 8, padding: "6px 10px", display: "inline-block",
        }}>
          你的回答：{answerLabel || "—"}
        </div>
      ) : event.method === "select" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto", marginBottom: 4 }}>
          {(event.options ?? []).map((opt) => (
            <button
              key={opt}
              onClick={() => onRespond({ value: opt })}
              style={{
                ...btnBase, width: "100%", textAlign: "left", height: 38, padding: "0 14px",
                border: `1px solid ${t.color.border}`, background: "transparent", color: t.color.fg,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.bg; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >{opt}</button>
          ))}
          {event.options?.length === 0 && (
            <div style={{ fontSize: "0.86em", color: t.color.muted, padding: "12px 4px" }}>（没有可用选项）</div>
          )}
        </div>
      ) : event.method === "input" ? (
        <div style={{ marginBottom: 4 }}>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onRespond({ value: inputValue }); }}
            placeholder={event.placeholder ?? "输入…"}
            style={{
              width: "100%", height: 38, padding: "0 12px", borderRadius: 9,
              border: `1px solid ${t.color.border}`, background: t.color.bg,
              color: t.color.fg, fontSize: "0.92em", outline: "none", fontFamily: "inherit",
            }}
          />
        </div>
      ) : null}

      {/* Footer actions — 确定/取消/确认 all on ONE horizontal row below the
          content (input keeps its own row; buttons never stack vertically). */}
      {!answered && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
          <button onClick={() => onRespond({ cancelled: true })} style={{ ...btnBase, border: `1px solid ${t.color.border}`, background: "transparent", color: t.color.fg }}>取消</button>
          {event.method === "confirm" && (
            <button onClick={() => onRespond({ confirmed: true })} style={{ ...btnBase, border: "none", background: t.color.primary, color: "#fff", fontWeight: 600 }}>确认</button>
          )}
          {event.method === "input" && (
            <button
              onClick={() => onRespond({ value: inputValue })}
              disabled={inputValue.trim().length === 0}
              style={{ ...btnBase, border: "none", background: t.color.primary, color: "#fff", fontWeight: 600, opacity: inputValue.trim().length === 0 ? 0.4 : 1, cursor: inputValue.trim().length === 0 ? "not-allowed" : "pointer" }}
            >确定</button>
          )}
        </div>
      )}
    </div>
  );
}
