import { useTheme } from "@vagus/ui-tokens";
import type { useTokens } from "@vagus/ui-tokens";
import type { ProviderConfigUI } from "@vagus/ui-tokens";
import { ApiSelect, Field, formatTokens } from "./shared.js";
import { IconEye, IconEyeOff, IconLink, IconPencil, IconPlus, IconTrash } from "./icons.js";
import { ConfirmDeleteModal, ModelAddModal } from "./models-modals.js";
import type { AddModelForm } from "./models-modals.js";

export interface ModelMeta {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface TestResult {
  modelId: string;
  ok: boolean;
  status?: number;
  reason?: "auth" | "model";
}

/** Right panel for the selected provider: always-editable form + model list. */
export function ProviderDetail({ provider, detail, setDetail, showKey, setShowKey, testingId, testResult, editingModelId, modelForm, setModelForm, addModelOpen, addModelForm, setAddModelForm, confirmDeleteId, providers, onToggleEnabled, onDelete, onConfirmDelete, onTest, onAddModel, onRemoveModel, onStartEdit, onSaveEdit, onCancelEdit, onCancelDelete, onOpenAddModel, onCloseAddModel, inputStyle, t, onProbe }: {
  provider: ProviderConfigUI;
  detail: { id: string; baseUrl: string; api: string; apiKey: string };
  setDetail: (d: { id: string; baseUrl: string; api: string; apiKey: string }) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  testingId: string | null;
  testResult: TestResult | undefined;
  editingModelId: string | null;
  modelForm: { contextWindow: string; maxTokens: string; vision: boolean };
  setModelForm: (f: { contextWindow: string; maxTokens: string; vision: boolean }) => void;
  addModelOpen: boolean;
  addModelForm: AddModelForm;
  setAddModelForm: React.Dispatch<React.SetStateAction<AddModelForm>>;
  confirmDeleteId: string | null;
  providers: ProviderConfigUI[];
  onToggleEnabled: () => void;
  onDelete: () => void;
  /** Actually deletes the provider (confirm dialog's confirm button). */
  onConfirmDelete: (id: string) => void;
  onTest: (modelId: string) => void;
  onAddModel: () => void;
  onRemoveModel: (modelId: string) => void;
  onStartEdit: (m: ModelMeta) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onCancelDelete: () => void;
  onOpenAddModel: () => void;
  onProbe?: (params: { baseUrl: string; api: string; apiKey?: string; model: string }) => Promise<{ ok: boolean; compat?: Record<string, unknown>; input?: string[]; reasoning?: boolean; error?: string }>;
  onCloseAddModel: () => void;
  inputStyle: React.CSSProperties;
  t: ReturnType<typeof useTokens>;
}): JSX.Element {
  const { theme: mdTheme } = useTheme();
  const active = provider;
  const paper = mdTheme === "light" ? "#ffffff" : t.color.surface;

  return (
    <>
      {/* Header: editable name + status pill + delete */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <input
          style={{ ...inputStyle, flex: 1, minWidth: 120, fontWeight: 600, fontSize: 14 }}
          value={detail.id}
          onChange={(e) => setDetail({ ...detail, id: e.target.value })}
          aria-label="供应商名称"
        />
        <div style={{ display: "inline-flex", background: t.color.bg, border: `1px solid ${t.color.border}`, borderRadius: 99, padding: 2, gap: 2, flexShrink: 0 }}>
          <button onClick={onToggleEnabled}
            onMouseEnter={(e) => { if (active.enabled !== false) e.currentTarget.style.filter = "brightness(1.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
            style={{
              border: "none", borderRadius: 99, padding: "4px 12px", fontSize: 12, cursor: "pointer",
              background: active.enabled !== false ? "#10B981" : "transparent",
              color: active.enabled !== false ? "#fff" : t.color.muted,
              transition: "filter 0.15s",
            }}>已启用</button>
          <button onClick={onToggleEnabled}
            onMouseEnter={(e) => { if (active.enabled === false) e.currentTarget.style.filter = "brightness(1.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
            style={{
              border: "none", borderRadius: 99, padding: "4px 12px", fontSize: 12, cursor: "pointer",
              background: active.enabled === false ? t.color.fg : "transparent",
              color: active.enabled === false ? t.color.bg : t.color.muted,
              transition: "filter 0.15s",
            }}>禁用</button>
        </div>
        <button onClick={onDelete} title="删除供应商"
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#E5484D"; e.currentTarget.style.color = "#E5484D"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.color.border; e.currentTarget.style.color = t.color.muted; }}
          style={{
            background: "transparent", border: `1px solid ${t.color.border}`, color: t.color.muted,
            borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0, transition: "all 0.15s",
          }}><IconTrash /></button>
      </div>

      {/* Always-editable connection form */}
      <Field label="Base URL">
        <input style={inputStyle} placeholder="https://api.example.com/v1" value={detail.baseUrl} onChange={(e) => setDetail({ ...detail, baseUrl: e.target.value })} />
      </Field>
      <Field label="API 格式">
        <ApiSelect value={detail.api} onChange={(v) => setDetail({ ...detail, api: v })} t={t} />
      </Field>
      <Field label="API Key">
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} type={showKey ? "text" : "password"} placeholder="留空保持不变" value={detail.apiKey} onChange={(e) => setDetail({ ...detail, apiKey: e.target.value })} />
          <button onClick={() => setShowKey(!showKey)} title={showKey ? "隐藏" : "显示"}
            onMouseEnter={(e) => e.currentTarget.style.color = t.color.fg}
            onMouseLeave={(e) => e.currentTarget.style.color = t.color.muted}
            style={{
              background: "transparent", border: `1px solid ${t.color.border}`, color: t.color.muted,
              borderRadius: 8, width: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "all 0.15s",
            }}>{showKey ? <IconEyeOff /> : <IconEye />}</button>
        </div>
      </Field>



      {/* Models */}
      <div style={{ fontSize: 13, fontWeight: 600, color: t.color.fg, marginBottom: 8 }}>模型列表</div>
      {active.models.length === 0 && (
        <div style={{ fontSize: 12, color: t.color.muted, marginBottom: 10 }}>暂无模型 — 添加一个以在聊天中可用。</div>
      )}
      {active.models.map((m) => (
        <div key={m.id}>
          <div onMouseEnter={(e) => e.currentTarget.style.background = t.color.border}
            onMouseLeave={(e) => e.currentTarget.style.background = paper}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8,
              background: paper, marginBottom: 6, fontSize: 13, transition: "background 0.15s",
            }}>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name ?? m.id}</span>
            {m.contextWindow !== undefined && (
              <span style={{ fontSize: 11, color: t.color.fg, background: t.color.bg, border: `1px solid ${t.color.border}`, borderRadius: 99, padding: "2px 8px", flexShrink: 0 }}>{formatTokens(m.contextWindow)}</span>
            )}
            {testingId === m.id ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ color: t.color.primary }}>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeLinecap="round" opacity="0.35" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                </path>
              </svg>
            ) : (
              <span role="button" aria-label={`测试 ${m.id}`} onClick={() => onTest(m.id)}
                onMouseEnter={(e) => e.currentTarget.style.color = t.color.fg}
                onMouseLeave={(e) => e.currentTarget.style.color = t.color.muted}
                style={{ color: t.color.muted, cursor: "pointer", display: "flex", padding: 2, transition: "color 0.15s" }}><IconLink size={13} /></span>
            )}
            <span role="button" aria-label={`编辑 ${m.id}`} onClick={() => onStartEdit(m)}
              onMouseEnter={(e) => e.currentTarget.style.color = t.color.fg}
              onMouseLeave={(e) => e.currentTarget.style.color = t.color.muted}
              style={{ color: t.color.muted, cursor: "pointer", display: "flex", padding: 2, transition: "color 0.15s" }}><IconPencil size={13} /></span>
            <span role="button" aria-label={`删除模型 ${m.id}`} onClick={() => onRemoveModel(m.id)}
              onMouseEnter={(e) => e.currentTarget.style.color = t.color.fg}
              onMouseLeave={(e) => e.currentTarget.style.color = t.color.muted}
              style={{ color: t.color.muted, cursor: "pointer", display: "flex", padding: 2, transition: "color 0.15s" }}><IconTrash size={13} /></span>
          </div>
          {testResult?.modelId === m.id && (
            <div style={{ marginBottom: 8 }}>
              {testResult.ok
                ? <span style={{ fontSize: 12, color: "#10B981", background: "rgba(16,185,129,0.12)", borderRadius: 6, padding: "3px 10px", display: "inline-block" }}>连接成功！</span>
                : <span style={{ fontSize: 12, color: "#E5484D", background: "rgba(229,72,77,0.1)", borderRadius: 6, padding: "3px 10px", display: "inline-block" }}>
                    {testResult.status === 0 ? "无法连接" : testResult.reason === "auth" ? "认证失败" : testResult.reason === "model" ? "模型不存在" : `连接失败 (HTTP ${testResult.status})`}
                  </span>}
            </div>
          )}
          {editingModelId === m.id && (
            <div style={{ background: t.color.bg, border: `1px solid ${t.color.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: t.color.muted, marginBottom: 4 }}>上下文窗口 (tokens)</label>
                  <input style={inputStyle} type="number" min={0} placeholder="128000" value={modelForm.contextWindow} onChange={(e) => setModelForm({ ...modelForm, contextWindow: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: t.color.muted, marginBottom: 4 }}>最大输出 (tokens)</label>
                  <input style={inputStyle} type="number" min={0} placeholder="8192" value={modelForm.maxTokens} onChange={(e) => setModelForm({ ...modelForm, maxTokens: e.target.value })} />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, cursor: "pointer", fontSize: 12.5, color: t.color.fg, userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={modelForm.vision}
                  onChange={(e) => setModelForm({ ...modelForm, vision: e.target.checked })}
                  style={{ width: 15, height: 15, accentColor: t.color.primary, cursor: "pointer" }}
                />
                <span>支持图片理解</span>
                <span style={{ color: t.color.muted, fontSize: 11 }}>（聊天中能否添加图片附件）</span>
              </label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                <button onClick={onCancelEdit} style={{
                  background: "transparent", border: `1px solid ${t.color.border}`, color: t.color.muted,
                  borderRadius: 7, padding: "5px 14px", fontSize: 12, cursor: "pointer",
                }}>取消</button>
                <button onClick={onSaveEdit} style={{
                  background: t.color.primary, color: "#fff", border: "none", borderRadius: 7,
                  padding: "5px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}>保存</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
        <button onClick={onOpenAddModel}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.color.fg; e.currentTarget.style.color = t.color.fg; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.color.border; e.currentTarget.style.color = t.color.muted; }}
          style={{
            background: "transparent", border: `1px dashed ${t.color.border}`, color: t.color.muted,
            borderRadius: 9, padding: "8px 18px", fontSize: 12.5, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
          }}><IconPlus size={13} /> 添加模型</button>
      </div>

      {/* Modals */}
      <ModelAddModal open={addModelOpen} form={addModelForm} setForm={setAddModelForm} onAdd={onAddModel} onClose={onCloseAddModel} inputStyle={inputStyle} t={t} onProbe={onProbe} provider={provider} />
      <ConfirmDeleteModal confirmDeleteId={confirmDeleteId} providers={providers} onConfirm={onConfirmDelete} onClose={onCancelDelete} t={t} />
    </>
  );
}