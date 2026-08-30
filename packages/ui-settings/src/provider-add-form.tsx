import { ApiSelect, Field } from "./shared.js";
import type { useTokens } from "@vagus/ui-tokens";

/** Add-provider form shown when no provider is selected. */
export function ProviderAddForm({ form, setForm, onAdd, canAdd, inputStyle, t }: {
  form: { id: string; baseUrl: string; apiKey: string; api: string };
  setForm: (f: { id: string; baseUrl: string; apiKey: string; api: string }) => void;
  onAdd: () => void;
  canAdd: boolean;
  inputStyle: React.CSSProperties;
  t: ReturnType<typeof useTokens>;
}): JSX.Element {
  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 600, color: t.color.fg }}>添加模型供应商</div>
      <div style={{ fontSize: 12, color: t.color.muted, margin: "4px 0 20px" }}>配置一个完全自定义的 API 端点和初始模型</div>
      <Field label="名称">
        <input style={inputStyle} placeholder="如：openai" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
      </Field>
      <Field label="Base URL">
        <input style={inputStyle} placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
      </Field>
      <Field label="API Key">
        <input style={inputStyle} type="password" placeholder="输入 API Key（可选）" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
      </Field>
      <Field label="API 格式">
        <ApiSelect value={form.api} onChange={(v) => setForm({ ...form, api: v })} t={t} />
      </Field>
      <button onClick={onAdd} disabled={!canAdd}
        onMouseEnter={(e) => { if (canAdd) e.currentTarget.style.filter = "brightness(1.15)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
        style={{
          width: "100%", background: canAdd ? t.color.primary : t.color.border, color: canAdd ? "#fff" : t.color.muted,
          border: "none", borderRadius: 10, padding: "11px 16px", fontSize: 13.5, fontWeight: 500,
          cursor: canAdd ? "pointer" : "default", transition: "filter 0.15s",
        }}>添加供应商</button>
    </>
  );
}