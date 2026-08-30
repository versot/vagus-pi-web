import { useEffect, useState } from "react";
import { useTokens } from "@vagus/ui-tokens";

/**
 * "@ file" picker — lists workspace files (via daemon project.files) with a
 * search box. Selecting a file appends a `@relpath` mention into the input.
 */

interface FileMentionPickerProps {
  cwd: string;
  listFiles: (cwd: string) => Promise<{ files: string[] }>;
  onPick: (relPath: string | null) => void;
}

export function FileMentionPicker({ cwd, listFiles, onPick }: FileMentionPickerProps): JSX.Element {
  const t = useTokens();
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setLoading(true);
    void listFiles(cwd)
      .then((r) => setFiles(r.files))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.toLowerCase();
  const filtered = files.filter((f) => f.toLowerCase().includes(q)).slice(0, 100);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[Math.min(active, filtered.length - 1)];
      if (pick) onPick(pick);
    } else if (e.key === "Escape") {
      onPick(null);
    }
  };

  const overlay: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 500,
    background: "rgba(0,0,0,0.35)",
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const card: React.CSSProperties = {
    width: 480, maxHeight: "70vh", background: t.color.bg,
    border: `1px solid ${t.color.border}`, borderRadius: 16,
    boxShadow: "0 24px 64px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", overflow: "hidden",
  };

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onPick(null); }}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px 10px", borderBottom: `1px solid ${t.color.border}`, flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: t.color.muted }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="搜索工作区文件…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: "0.96em", color: t.color.fg, fontFamily: "inherit" }}
          />
          <span style={{ fontSize: "0.79em", color: t.color.muted }}>{cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd}</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 6, minHeight: 200 }}>
          {loading ? (
            <div style={{ padding: "28px 0", textAlign: "center", color: t.color.muted, fontSize: "0.93em" }}>加载中…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "28px 0", textAlign: "center", color: t.color.muted, fontSize: "0.93em" }}>（没有匹配的文件）</div>
          ) : (
            filtered.map((f, i) => (
              <div
                key={f}
                onClick={() => onPick(f)}
                onMouseEnter={() => setActive(i)}
                style={{ display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 10px", borderRadius: 8, cursor: "pointer", fontSize: "0.89em", color: t.color.fg, background: i === active ? t.color.surface : "transparent" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                title={f}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, color: t.color.muted }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
