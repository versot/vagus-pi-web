import { useTheme } from "@vagus/ui-tokens";
import type { useTokens } from "@vagus/ui-tokens";
import type { ProviderConfigUI } from "@vagus/ui-tokens";
import { IconBox, IconPlus } from "./icons.js";

/** Left sidebar: the custom provider list. */
export function ProviderSidebar({ providers, selectedId, adding, onSelect, onAdd, t }: {
  providers: ProviderConfigUI[];
  selectedId: string | null;
  adding: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  t: ReturnType<typeof useTokens>;
}): JSX.Element {
  const { theme: mdTheme } = useTheme();
  return (
    <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${t.color.border}`, padding: 10, background: mdTheme === "light" ? "#ffffff" : t.color.surface }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 10px 6px" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: t.color.muted, letterSpacing: "0.04em" }}>自定义供应商</span>
        <button onClick={onAdd} title="添加供应商"
          onMouseEnter={(e) => e.currentTarget.style.color = t.color.fg}
          onMouseLeave={(e) => e.currentTarget.style.color = t.color.muted}
          style={{ background: "transparent", border: "none", color: t.color.muted, cursor: "pointer", display: "flex", padding: 2, transition: "color 0.15s" }}><IconPlus size={14} /></button>
      </div>
      {providers.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: t.color.muted, padding: "8px 10px" }}>暂无供应商</div>
      )}
      {providers.map((p) => {
        const isActive = selectedId === p.id && !adding;
        const enabled = p.enabled !== false;
        return (
          <div key={p.id} onClick={() => onSelect(p.id)}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = t.color.surface; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9,
              fontSize: 13, color: t.color.fg, cursor: "pointer",
              transition: "background 0.15s",
              background: isActive ? t.color.border : "transparent",
            }}>
            <IconBox size={14} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.id}</span>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: enabled ? "#10B981" : t.color.muted, flexShrink: 0 }} />
          </div>
        );
      })}
    </div>
  );
}