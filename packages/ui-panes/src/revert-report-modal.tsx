import { useEffect, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";
import type { RevertResult } from "@vagus/ui-chat";

/** Aggregated revert outcome rendered by {@link RevertReportModal}. */
export interface RevertReport {
  results: RevertResult[];
}

type ReportState = "ok" | "partial" | "fail";

const EASE = "cubic-bezier(0.25, 1, 0.5, 1)";

/** Round status badge (check / warning / cross) tinted by outcome state. */
function StatusBadge({ state }: { state: ReportState }): JSX.Element {
  const t = useTokens();
  const accent = state === "ok" ? t.color.success : state === "partial" ? t.color.warning : t.color.error;
  const paths =
    state === "ok"
      ? ["M20 6L9 17l-5-5"]
      : state === "partial"
        ? ["M12 9v4", "M12 17h.01", "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"]
        : ["M18 6L6 18", "M6 6l12 12"];
  return (
    <div
      style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `${accent}1f`, // ~12% alpha
        color: accent,
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </div>
  );
}

/** One file line: name + per-file outcome badge (✓ 已回退 / ✗ error). */
function FileRow({ result }: { result: { file: string; ok: boolean; error?: string } }): JSX.Element {
  const t = useTokens();
  const slash = result.file.lastIndexOf("/");
  const dir = slash >= 0 ? result.file.slice(0, slash + 1) : "";
  const name = slash >= 0 ? result.file.slice(slash + 1) : result.file;
  return (
    <div
      style={{
        padding: "7px 10px", borderRadius: 8,
        background: result.ok ? "transparent" : `${t.color.error}0d`,
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.82em" }}>
          <span style={{ color: t.color.muted }}>{dir}</span>
          <span style={{ color: t.color.fg, fontWeight: 500 }}>{name}</span>
        </span>
        {result.ok ? (
          <span style={{ flexShrink: 0, color: t.color.success, fontSize: "0.72em", fontWeight: 600, whiteSpace: "nowrap" }}>
            ✓ 已回退
          </span>
        ) : (
          <span style={{ flexShrink: 0, color: t.color.error, fontSize: "0.72em", fontWeight: 600, whiteSpace: "nowrap" }}>
            ✗ 回退失败
          </span>
        )}
      </div>
      {!result.ok && result.error && (
        <div
          style={{
            marginTop: 4, color: t.color.error, fontSize: "0.7em", lineHeight: 1.5,
            whiteSpace: "normal", wordBreak: "break-word",
          }}
        >
          {result.error}
        </div>
      )}
    </div>
  );
}

/**
 * Centered result modal shown after a revert action (Codex-style report):
 * a status badge + summary, the per-file outcomes (failures tinted red with
 * the reason), and a 关闭 button. Dismiss via ✕, 关闭, Escape, or backdrop.
 */
export function RevertReportModal({ report, onClose }: { report: RevertReport; onClose: () => void }): JSX.Element {
  const t = useTokens();
  const [shown, setShown] = useState(false);

  const okCount = report.results.filter((r) => r.ok).length;
  const failCount = report.results.length - okCount;
  const state: ReportState = failCount === 0 ? "ok" : okCount === 0 ? "fail" : "partial";
  // Aggregate per file (a file can carry several edits); a file is a failure
  // if any of its edits failed.
  const perFile = new Map<string, { ok: boolean; error?: string }>();
  for (const r of report.results) {
    const prev = perFile.get(r.file);
    // A file is a failure if ANY of its edits failed; the first record has
    // no prev, so default it to true (prev && r.ok: first record = r.ok).
    perFile.set(r.file, { ok: (prev?.ok ?? true) && r.ok, error: !r.ok ? (r.error ?? prev?.error) : prev?.error });
  }
  const fileResults = [...perFile.entries()].map(([file, v]) => ({ file, ...v }));

  // Fade/slide in on mount.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Escape dismisses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accent = state === "ok" ? t.color.success : state === "partial" ? t.color.warning : t.color.error;
  const title =
    state === "ok" ? `已回退 ${okCount} 个文件`
      : state === "partial" ? "回退部分失败"
        : "回退失败";
  const summary =
    state === "ok" ? "所有改动已还原到编辑前状态"
      : state === "partial" ? `成功 ${okCount} 个 · 失败 ${failCount} 个`
        : failCount === 1 ? "1 个文件未还原" : `${failCount} 个文件未还原`;

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        opacity: shown ? 1 : 0,
        transition: `opacity 0.25s ${EASE}`,
        fontFamily: t.font.sans,
      }}
    >
      {/* Card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 500, maxWidth: "calc(100vw - 40px)",
          background: t.color.surface,
          border: `1px solid ${t.color.border}`,
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
          padding: "20px 22px 18px",
          opacity: shown ? 1 : 0,
          transform: shown ? "none" : "translateY(10px) scale(0.97)",
          transition: `opacity 0.3s ${EASE}, transform 0.3s ${EASE}`,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <StatusBadge state={state} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: t.color.fg, fontSize: "1.02em", fontWeight: 700 }}>{title}</span>
              <button
                onClick={onClose}
                aria-label="关闭"
                style={{
                  marginLeft: "auto", width: 26, height: 26, borderRadius: 7,
                  border: "none", background: "transparent", color: t.color.muted,
                  cursor: "pointer", display: "flex", alignItems: "center",
                  justifyContent: "center", fontFamily: "inherit", flexShrink: 0,
                  transition: "background 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.color.bg; e.currentTarget.style.color = t.color.fg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.color.muted; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div style={{ color: t.color.muted, fontSize: "0.82em", marginTop: 2 }}>{summary}</div>
            {/* Accent hairline under header */}
            <div style={{ height: 2, background: `linear-gradient(90deg, ${accent}, transparent)`, borderRadius: 2, marginTop: 10, opacity: 0.5 }} />
          </div>
        </div>

        {/* File outcomes */}
        {fileResults.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 14, maxHeight: 240, overflowY: "auto" }}>
            {fileResults.map((r) => (
              <FileRow key={r.file} result={r} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button
            onClick={onClose}
            style={{
              height: 32, padding: "0 18px", borderRadius: 8, border: "none",
              background: `linear-gradient(135deg, ${t.color.primary}, #6366f1)`,
              color: "#fff", fontSize: "0.84em", fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
              transition: "filter 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
