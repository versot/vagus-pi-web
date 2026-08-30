/** Model providers settings — container (state + handlers + composition). */

import { useEffect, useRef, useState } from "react";
import type { useTokens } from "@vagus/ui-tokens";
import type { ProviderConfigUI } from "@vagus/ui-tokens";
import { IconRefresh } from "./icons.js";
import { ProviderSidebar } from "./provider-sidebar.js";
import { ProviderAddForm } from "./provider-add-form.js";
import { ProviderDetail } from "./provider-detail.js";
import type { AddModelForm } from "./models-modals.js";

export function ModelsView({ providers, inputStyle, t, onSave, onRefresh, onTest, onProbe, }: {
  providers: ProviderConfigUI[];
  inputStyle: React.CSSProperties;
  t: ReturnType<typeof useTokens>;
  onSave: (providers: ProviderConfigUI[]) => Promise<void>;
  onRefresh: () => void;
  onTest: (params: { baseUrl: string; api: string; apiKey?: string; model?: string }) => Promise<{ ok: boolean; status?: number; reason?: "auth" | "model" }>;
  onProbe: (params: { baseUrl: string; api: string; apiKey?: string; model: string }) => Promise<{ ok: boolean; compat?: Record<string, unknown>; input?: string[]; reasoning?: boolean; error?: string }>;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [detail, setDetail] = useState({ id: "", baseUrl: "", api: "openai-completions", apiKey: "" });
  const [showKey, setShowKey] = useState(false);
  const [form, setForm] = useState({ id: "", baseUrl: "", apiKey: "", api: "openai-completions" });
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [addModelForm, setAddModelForm] = useState<AddModelForm>({ id: "", contextWindow: "2000000", maxTokens: "131072", vision: false });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState({ contextWindow: "", maxTokens: "", vision: true });
  const [testResult, setTestResult] = useState<{ modelId: string; ok: boolean; status?: number; reason?: "auth" | "model" } | undefined>(undefined);

  const active = selectedId !== null && !adding
    ? providers.find((p) => p.id === selectedId) ?? null
    : null;

  const selectProvider = (id: string): void => {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    setSelectedId(id);
    setAdding(false);
    setEditingModelId(null);
    setTestResult(undefined);
    const next = { id: p.id, baseUrl: p.baseUrl, api: p.api, apiKey: p.apiKey ?? "" };
    lastSavedSig.current = JSON.stringify(next);
    setDetail(next);
  };

  const startAdd = (): void => {
    setAdding(true);
    setSelectedId(null);
    setEditingModelId(null);
    setForm({ id: "", baseUrl: "", apiKey: "", api: "openai-completions" });
  };

  const addProvider = (): void => {
    const id = form.id.trim();
    const baseUrl = form.baseUrl.trim();
    if (!id || !baseUrl) return;
    void onSave([...providers, { id, baseUrl, api: form.api, apiKey: form.apiKey.trim() || undefined, models: [] }]);
    const next = { id, baseUrl, api: form.api, apiKey: form.apiKey };
    lastSavedSig.current = JSON.stringify(next);
    setAdding(false);
    setSelectedId(id);
    setDetail(next);
  };

  const removeProvider = (id: string): void => {
    void onSave(providers.filter((p) => p.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      lastSavedSig.current = "";
      setDetail({ id: "", baseUrl: "", api: "openai-completions", apiKey: "" });
    }
  };

  useEffect(() => {
    if (!adding && selectedId === null && providers.length > 0) {
      const first = providers[0];
      if (first !== undefined) selectProvider(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, providers.length, selectedId]);

  const lastSavedSig = useRef("");
  useEffect(() => {
    if (selectedId === null) return;
    const p0 = providers.find((x) => x.id === selectedId);
    if (!p0) return;
    const sig = JSON.stringify(detail);
    if (sig === lastSavedSig.current) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const newId = detail.id.trim();
        const baseUrl = detail.baseUrl.trim();
        if (!newId) return;
        lastSavedSig.current = sig;
        await onSave(providers.map((p) => p.id === selectedId
          ? { ...p, id: newId, baseUrl: baseUrl || p.baseUrl, api: detail.api, apiKey: detail.apiKey.trim() !== "" ? detail.apiKey.trim() : p.apiKey }
          : p,
        ));
        if (newId !== selectedId) setSelectedId(newId);
      })();
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, selectedId]);

  const toggleEnabled = (): void => {
    if (!active) return;
    void onSave(providers.map((p) => p.id === active.id ? { ...p, enabled: p.enabled === false } : p));
  };

  const testConnection = async (modelId: string): Promise<void> => {
    if (!active) return;
    setTestingId(modelId);
    setTestResult(undefined);
    const r = await onTest({ baseUrl: detail.baseUrl.trim() || active.baseUrl, api: detail.api || active.api, apiKey: detail.apiKey.trim() || active.apiKey, model: modelId });
    setTestResult({ modelId, ...r });
    setTestingId(null);
  };

  const addModel = (): void => {
    if (!active) return;
    const mid = addModelForm.id.trim();
    if (!mid) return;
    const compat = addModelForm.compat;
    const reasoning = addModelForm.reasoning;
    void onSave(providers.map((p) => p.id === active.id ? { ...p, models: [...p.models, {
      id: mid,
      contextWindow: addModelForm.contextWindow !== "" ? Number(addModelForm.contextWindow) : undefined,
      maxTokens: addModelForm.maxTokens !== "" ? Number(addModelForm.maxTokens) : undefined,
      input: addModelForm.vision ? ["text", "image"] : ["text"],
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(compat ? { compat } : {}),
    }] } : p));
    setAddModelOpen(false);
  };

  const removeModel = (modelId: string): void => {
    if (!active) return;
    void onSave(providers.map((p) => p.id === active.id ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p));
    if (editingModelId === modelId) setEditingModelId(null);
  };

  const startModelEdit = (m: { id: string; contextWindow?: number; maxTokens?: number; input?: string[] }): void => {
    setEditingModelId(m.id);
    setModelForm({ contextWindow: m.contextWindow !== undefined ? String(m.contextWindow) : "", maxTokens: m.maxTokens !== undefined ? String(m.maxTokens) : "", vision: m.input?.includes("image") ?? true });
  };

  const saveModelEdit = (): void => {
    if (!active || editingModelId === null) return;
    void onSave(providers.map((p) => p.id === active.id ? { ...p, models: p.models.map((m) => m.id === editingModelId ? { ...m, contextWindow: modelForm.contextWindow !== "" ? Number(modelForm.contextWindow) : undefined, maxTokens: modelForm.maxTokens !== "" ? Number(modelForm.maxTokens) : undefined, input: modelForm.vision ? ["text", "image"] : ["text"] } : m) } : p));
    setEditingModelId(null);
  };

  const canAdd = form.id.trim() !== "" && form.baseUrl.trim() !== "";

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: t.color.fg }}>模型设置</div>
          <div style={{ fontSize: 13, color: t.color.muted, margin: "4px 0 0" }}>管理自定义模型供应商，配置后可在聊天时选择使用。</div>
        </div>
        <button onClick={onRefresh} title="刷新配置" style={{ background: "transparent", border: `1px solid ${t.color.border}`, color: t.color.muted, borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}><IconRefresh /></button>
      </div>

      <div style={{ display: "flex", border: `1px solid ${t.color.border}`, borderRadius: 14, overflow: "hidden", background: t.color.bg }}>
        <ProviderSidebar providers={providers} selectedId={selectedId} adding={adding} onSelect={selectProvider} onAdd={startAdd} t={t} />
        <div style={{ flex: 1, padding: "22px 24px", minWidth: 0 }}>
          {!adding && active !== null ? (
            <ProviderDetail
              provider={active} detail={detail} setDetail={setDetail} showKey={showKey} setShowKey={setShowKey}
              testingId={testingId} testResult={testResult} editingModelId={editingModelId} modelForm={modelForm} setModelForm={setModelForm}
              addModelOpen={addModelOpen} addModelForm={addModelForm} setAddModelForm={setAddModelForm} confirmDeleteId={confirmDeleteId} providers={providers}
              onToggleEnabled={toggleEnabled} onDelete={() => setConfirmDeleteId(selectedId)} onConfirmDelete={(id) => removeProvider(id)} onTest={testConnection} onAddModel={addModel}
              onRemoveModel={removeModel} onStartEdit={startModelEdit} onSaveEdit={saveModelEdit} onCancelEdit={() => setEditingModelId(null)}
              onCancelDelete={() => setConfirmDeleteId(null)} onOpenAddModel={() => { setAddModelForm({ id: "", contextWindow: "2000000", maxTokens: "131072", vision: false }); setAddModelOpen(true); }} onCloseAddModel={() => setAddModelOpen(false)}
              inputStyle={inputStyle} t={t} onProbe={onProbe}
            />
          ) : (
            <ProviderAddForm form={form} setForm={setForm} onAdd={addProvider} canAdd={canAdd} inputStyle={inputStyle} t={t} />
          )}
        </div>
      </div>
    </>
  );
}
