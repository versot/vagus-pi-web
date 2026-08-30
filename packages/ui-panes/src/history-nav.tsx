import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { useTokens } from "@vagus/ui-tokens";
import type { ChatItem } from "@vagus/ui-chat";

/**
 * History nav — a slim rail of tick marks pinned to the left edge of the
 * chat pane, vertically centered. Each tick is one user message in order;
 * hovering lengthens it and shows a preview tooltip, clicking smooth-scrolls
 * to that message. Shows the most recent 20 ticks; overflow scrolls within
 * the rail (scrollbar hidden via .vagus-nav-scroll CSS).
 */
export function HistoryNav({ items, scrollRef, activeId }: {
  items: ChatItem[];
  scrollRef: RefObject<HTMLElement | null>;
  /** When the active session changes, scroll the rail to the bottom (newest tick). */
  activeId?: string;
}): JSX.Element | null {
  const t = useTokens();
  // For each user message (in REAL message order — the index is what the
  // chat pane stamps as data-msg-index), pair it with the turn's answer.
  const entries = useMemo(() => {
    const out: Array<{ msgIndex: number; question: string; answer: string }> = [];
    let userIndex = 0;
    let lastAnswer = "";
    for (const item of items) {
      if (item.kind === "user") {
        out.push({ msgIndex: userIndex, question: item.text, answer: "" });
        lastAnswer = "";
        userIndex++;
      } else if (item.kind === "assistant") {
        lastAnswer = item.text;
        if (out.length > 0) out[out.length - 1]!.answer = lastAnswer;
      }
    }
    // All user messages become ticks; each tick is fixed 15px (flexShrink 0
    // below) so they never compress. The rail's maxHeight caps the VISIBLE
    // count (~20) and overflowY scrolls the rest.
    return out;
  }, [items]);
  const [hovered, setHovered] = useState<{ index: number; question: string; answer: string; x: number; y: number } | null>(null);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const railRef = useRef<HTMLDivElement>(null);

  // Scroll the rail to the bottom (newest tick) when switching sessions.
  useEffect(() => {
    const el = railRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={railRef}
      className="vagus-nav-scroll"
      style={{
        position: "absolute",
        left: 6,
        top: "50%",
        transform: "translateY(-50%)",
        width: 24,
        // Exactly 20 ticks × 15px visible at once; older ticks scroll into
        // view via overflowY (scrollbar hidden).
        maxHeight: 300,
        overflowY: "auto",
        // Container itself is interactive so the WHEEL scrolls the rail when
        // overflowing (ticks below keep pointer-events:auto for hover/click).
        // No scrollbar — hidden via .vagus-nav-scroll CSS.
        pointerEvents: "auto",
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        padding: "2px 0",
      }}
    >
      {entries.map(({ msgIndex, question, answer }, i) => {
        // Tiered length: the hovered tick is longest; neighbours are mid;
        // everything else is short — a smooth lens-like curve around the
        // selection.
        const dist = hoverIndex === -1 ? 99 : Math.abs(i - hoverIndex);
        const width = dist === 0 ? 26 : dist === 1 ? 19 : 13;
        const bg =
          dist === 0 ? "#6366f1" : dist === 1 ? "rgba(99,102,241,0.55)" : t.color.border;
        return (
          // Tall invisible hit area per tick, so hovering the blank space
          // between ticks activates the *nearest* tick.
          <div
            key={msgIndex}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={(e) => { setHoverIndex(i); setHovered({ index: msgIndex, question, answer, x: e.clientX, y: e.clientY }); }}
            onMouseLeave={() => { setHoverIndex(-1); setHovered(null); }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Blur any focused editable so no stray caret stays visible
              // after jumping to the message.
              const active = document.activeElement;
              if (active instanceof HTMLElement) active.blur();
              const node = scrollRef.current?.querySelector(`[data-msg-index="${msgIndex}"]`);
              if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            style={{
              height: 15,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
              pointerEvents: "auto",
            }}
          >
            <div
              style={{
                width,
                height: 3,
                borderRadius: 2,
                background: bg,
                transition: "width 0.15s, background 0.15s",
                flexShrink: 0,
              }}
            />
          </div>
        );
      })}
      {hovered &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: hovered.x + 18,
              top: Math.max(8, Math.min(hovered.y - 12, window.innerHeight - 80)),
              zIndex: 1000,
              pointerEvents: "none",
              background: t.color.surface,
              border: `1px solid ${t.color.border}`,
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: "0.78em",
              color: t.color.fg,
              maxWidth: 300,
              lineHeight: 1.5,
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            }}
          >
            {/* question on top, answer below with a gap — no labels */}
            <div style={{ wordBreak: "break-word" }}>
              {hovered.question.length > 60 ? `${hovered.question.slice(0, 60)}…` : hovered.question || "（空消息）"}
            </div>
            <div
              style={{
                marginTop: 6,
                color: t.color.muted,
                wordBreak: "break-word",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {hovered.answer.replace(/\s+/g, " ") || "（暂无回答）"}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
