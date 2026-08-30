import { useState } from "react";
import { useTokens } from "@vagus/ui-tokens";
import type { TokensReadonly } from "@vagus/ui-tokens";

/**
 * "/" command picker — lists every command the web GUI can dispatch:
 * - `builtin`  — web-native session ops (compact/new/abort/...) routed by the
 *                frontend to engine RPCs (pi's TUI builtin slash commands are
 *                NOT dispatched by session.prompt(), so these are mapped here).
 * - `extension`— pi extension commands (pi.registerCommand); session.prompt()
 *                dispatches them directly.
 * - `skill`    — /skill:<name> — session.prompt() expands them.
 * - `template` — /<name> prompt templates — session.prompt() expands them.
 */

export interface CommandInfo {
  type: "builtin" | "extension" | "skill" | "template";
  /** Command without the leading slash: "compact", "skill:frontend-design". */
  name: string;
  description: string;
}

/** Per-category accent color (theme tokens → auto light/dark). */
export function commandColor(type: CommandInfo["type"], t: TokensReadonly): string {
  switch (type) {
    case "extension": return t.color.success; // 工具指令 — 绿
    case "skill": return t.color.warning;     // skill — 琥珀
    case "template": return t.color.accent;   // 模板 — 浅蓝
    default: return t.color.primary;           // pi 原生指令 — 蓝
  }
}

const SECTION_TITLES: Record<CommandInfo["type"], string> = {
  builtin: "pi 原生指令",
  extension: "工具指令",
  skill: "Skills",
  template: "模板",
};

interface CommandPickerProps {
  commands: CommandInfo[];
  onPick: (command: string | null) => void;
}

export function CommandPicker({ commands, onPick }: CommandPickerProps): JSX.Element {
  const t = useTokens();
  const [query, setQuery] = useState("");

  const q = query.toLowerCase().replace(/^\//, "");
  const filtered = commands.filter(
    (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
  );
  // Keep section order stable (builtin → extension → skill → template).
  const sections: CommandInfo["type"][] = ["builtin", "extension", "skill", "template"];

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
  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, height: 36, padding: "0 10px", borderRadius: 8,
    cursor: "pointer", fontSize: "0.89em", color: t.color.fg,
  };

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onPick(null); }}>
      <div style={card} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px 10px", borderBottom: `1px solid ${t.color.border}`, flexShrink: 0 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: t.color.muted }}><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onPick(null); }}
            placeholder="输入 / 命令…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: "0.96em", color: t.color.fg, fontFamily: "inherit" }}
          />
          <span style={{ fontSize: "0.72em", color: t.color.muted, flexShrink: 0 }}>{filtered.length} 项</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 6, minHeight: 160 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px 10px", color: t.color.muted, fontSize: "0.86em" }}>（没有匹配的命令）</div>
          ) : (
            sections.flatMap((type) => {
              const group = filtered.filter((c) => c.type === type);
              if (group.length === 0) return [];
              return [
                <div key={type} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 4px", fontSize: "0.75em", fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: t.color.muted }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: commandColor(type, t), flexShrink: 0 }} />
                  {SECTION_TITLES[type]}
                </div>,
                ...group.map((c) => (
                  <div key={`${type}:${c.name}`} onClick={() => onPick(`/${c.name}`)} style={row}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = t.color.surface; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <span style={{ color: commandColor(type, t), fontWeight: 600, flexShrink: 0, fontSize: "0.86em" }}>/{c.name}</span>
                    <span style={{ color: t.color.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.description}</span>
                  </div>
                )),
              ];
            })
          )}
        </div>
      </div>
    </div>
  );
}
