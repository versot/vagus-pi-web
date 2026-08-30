import { useTokens } from "@vagus/ui-tokens";

/** Center max-width shared with other chat cards. */
const MAX_W = 720;

const BRAND_A = "#6366f1";
const BRAND_B = "#8b5cf6";

/**
 * Compaction note — a single-line brand-tinted marker shown after pi
 * summarized earlier context away. No summary text is displayed; only the
 * post-compaction token count (when available from the live compact call).
 */
export function CompactionNote({ text }: { text: string }): JSX.Element {
  const t = useTokens();

  // Live compaction stamps "剩余 X.XK 上下文"; history reloads don't carry
  // token counts, so fall back to a bare marker.
  const match = /剩余\s*([\d.]+)\s*K/.exec(text);

  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "4px 0" }}>
      <div
        style={{
          maxWidth: MAX_W,
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.02))",
          border: "1px solid rgba(99,102,241,0.14)",
          borderRadius: 10,
          padding: "8px 12px 8px 16px",
        }}
      >
        {/* Left brand accent bar */}
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: `linear-gradient(180deg, ${BRAND_A}, ${BRAND_B})`,
          }}
        />

        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={BRAND_A} strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M4 9h6V3M20 15h-6v6M20 9h-6V3M4 15h6v6" />
        </svg>

        <span
          style={{
            color: t.color.muted,
            fontSize: "0.85em",
            lineHeight: 1.5,
          }}
        >
          <span style={{ color: BRAND_A, fontWeight: 600 }}>前文已摘要</span>
          {match ? <span style={{ opacity: 0.75 }}> · 剩余 {match[1]}K 上下文</span> : null}
        </span>
      </div>
    </div>
  );
}
