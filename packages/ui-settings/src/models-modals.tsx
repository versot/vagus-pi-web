import { useRef, useState } from "react";
import { useTheme } from "@vagus/ui-tokens";
import type { useTokens } from "@vagus/ui-tokens";
import type { ProviderConfigUI } from "@vagus/ui-tokens";
import { Field } from "./shared.js";

/** Shared overlay style for modals. */
function overlayBg(mdTheme: string, t: ReturnType<typeof useTokens>): string {
  return mdTheme === "light" ? "#ffffff" : t.color.surface;
}

/** Form state for the add-model modal. */
export interface AddModelForm {
  id: string;
  contextWindow: string;
  maxTokens: string;
  vision: boolean;
  compat?: Record<string, unknown>;
  reasoning?: boolean;
}

/** Add-model modal (id + context window + max output + image support). */
export function ModelAddModal({ open, form, setForm, onAdd, onClose, inputStyle, t, onProbe, provider }: {
  open: boolean;
  form: AddModelForm;
  setForm: React.Dispatch<React.SetStateAction<AddModelForm>>;
  onAdd: () => void;
  onClose: () => void;
  inputStyle: React.CSSProperties;
  t: ReturnType<typeof useTokens>;
  /** Auto-probes the endpoint and fills compat/vision/reasoning. */
  onProbe?: (params: { baseUrl: string; api: string; apiKey?: string; model: string }) => Promise<{ ok: boolean; compat?: Record<string, unknown>; input?: string[]; reasoning?: boolean; error?: string }>;
  provider?: { baseUrl: string; api: string; apiKey?: string };
}): JSX.Element | null {
  const { theme: mdTheme } = useTheme();
  const [probeState, setProbeState] = useState<"idle" | "probing" | "ok" | "fail">("idle");
  const probeTimer = useRef<number | undefined>(undefined);
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: overlayBg(mdTheme, t), border: `1px solid ${t.color.border}`, borderRadius: 14, padding: 22, width: 400, maxWidth: "90vw", boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, color: t.color.fg }}>添加模型</div>
        <div style={{ fontSize: 12, color: t.color.muted, margin: "4px 0 18px" }}>配置模型的标识与参数，保存后可在聊天中选用。</div>
        <Field label="模型 ID">
          <input
            style={inputStyle}
            autoFocus
            placeholder="如 gpt-4o（自动探测兼容配置）"
            value={form.id}
            onChange={(e) => {
              const id = e.target.value;
              setForm((prev) => ({ ...prev, id }));
              if (probeTimer.current !== undefined) window.clearTimeout(probeTimer.current);
              if (onProbe && provider && id.trim() !== "") {
                const mid = id.trim();
                setProbeState("probing");
                probeTimer.current = window.setTimeout(() => {
                  probeTimer.current = undefined;
                  void onProbe({ baseUrl: provider.baseUrl, api: provider.api, apiKey: provider.apiKey, model: mid })
                    .then((r) => {
                      if (r.ok && r.compat) {
                        setForm((prev) => prev.id.trim() === mid
                          ? { ...prev, compat: (r.compat as Record<string, unknown>) ?? undefined, reasoning: r.reasoning, vision: r.input?.includes("image") ?? prev.vision }
                          : prev);
                        setProbeState("ok");
                      } else {
                        setProbeState("fail");
                      }
                    })
                    .catch(() => setProbeState("fail"));
                }, 600);
              } else {
                setProbeState("idle");
              }
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && form.id.trim() !== "" && probeState !== "probing") onAdd(); }}
          />
        </Field>
        {(() => {
          if (form.id.trim() !== "") {
            if (probeState === "probing") {
              return (
                <div style={{ fontSize: 11.5, color: "#6366f1", background: "rgba(99,102,241,0.08)", borderRadius: 6, padding: "5px 10px", marginTop: -4, marginBottom: 4 }}>
                  正在自动探测模型能力…
                </div>
              );
            }
            if (probeState === "ok") {
              return (
                <div style={{ fontSize: 11.5, color: "#10B981", background: "rgba(16,185,129,0.1)", borderRadius: 6, padding: "5px 10px", marginTop: -4, marginBottom: 4 }}>
                  ✓ 自动探测完成：compat/图片/思考配置已自动填入
                </div>
              );
            }
            if (probeState === "fail") {
              return (
                <div style={{ fontSize: 11.5, color: "#E5484D", background: "rgba(229,72,77,0.08)", borderRadius: 6, padding: "5px 10px", marginTop: -4, marginBottom: 4 }}>
                  自动探测失败 — 请检查 baseUrl / apiKey，或稍后重试
                </div>
              );
            }
          }
          return null;
        })()}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: t.color.muted, marginBottom: 4 }}>上下文窗口 (tokens)</label>
            <input style={inputStyle} type="number" min={0} placeholder="2000000" value={form.contextWindow} onChange={(e) => setForm({ ...form, contextWindow: e.target.value })} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 500, color: t.color.muted, marginBottom: 4 }}>最大输出 (tokens)</label>
            <input style={inputStyle} type="number" min={0} placeholder="131072" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: e.target.value })} />
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, cursor: "pointer", fontSize: 12.5, color: t.color.fg, userSelect: "none" }}>
          <input
            type="checkbox"
            checked={form.vision}
            onChange={(e) => setForm({ ...form, vision: e.target.checked })}
            style={{ width: 15, height: 15, accentColor: t.color.primary, cursor: "pointer" }}
          />
          <span>支持图片理解</span>
          <span style={{ color: t.color.muted, fontSize: 11 }}>（决定聊天中能否添加图片附件）</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button onClick={onClose} style={{
            background: "transparent", border: `1px solid ${t.color.border}`, color: t.color.muted,
            borderRadius: 8, padding: "7px 18px", fontSize: 12.5, cursor: "pointer",
          }}>取消</button>
          <button onClick={onAdd} disabled={form.id.trim() === "" || probeState === "probing"}
            onMouseEnter={(e) => { if (form.id.trim() !== "" && probeState !== "probing") e.currentTarget.style.filter = "brightness(1.15)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
            style={{
              background: t.color.primary, color: "#fff", border: "none", borderRadius: 8, padding: "7px 18px",
              fontSize: 12.5, fontWeight: 500, cursor: form.id.trim() === "" || probeState === "probing" ? "not-allowed" : "pointer", transition: "filter 0.15s",
              opacity: form.id.trim() === "" || probeState === "probing" ? 0.5 : 1,
            }}>{probeState === "probing" ? "正在探测…" : "添加"}</button>
        </div>
      </div>
    </div>
  );
}

/** Confirm-delete modal for a provider. */
export function ConfirmDeleteModal({ confirmDeleteId, providers, onConfirm, onClose, t }: {
  confirmDeleteId: string | null;
  providers: ProviderConfigUI[];
  onConfirm: (id: string) => void;
  onClose: () => void;
  t: ReturnType<typeof useTokens>;
}): JSX.Element | null {
  const { theme: mdTheme } = useTheme();
  if (confirmDeleteId === null) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: overlayBg(mdTheme, t), border: `1px solid ${t.color.border}`, borderRadius: 14, padding: 22, width: 340, maxWidth: "90vw", boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, color: t.color.fg }}>删除供应商</div>
        <div style={{ fontSize: 12.5, color: t.color.muted, margin: "10px 0 22px", lineHeight: 1.7 }}>
          确定删除供应商 <span style={{ color: t.color.fg, fontWeight: 500 }}>“{providers.find((p) => p.id === confirmDeleteId)?.id ?? confirmDeleteId}”</span> 吗？其下模型将一并移除，此操作不可撤销。
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{
            background: "transparent", border: `1px solid ${t.color.border}`, color: t.color.muted,
            borderRadius: 8, padding: "7px 18px", fontSize: 12.5, cursor: "pointer",
          }}>取消</button>
          <button onClick={() => { onConfirm(confirmDeleteId); onClose(); }}
            onMouseEnter={(e) => e.currentTarget.style.filter = "brightness(1.15)"}
            onMouseLeave={(e) => e.currentTarget.style.filter = "none"}
            style={{
              background: "#E5484D", color: "#fff", border: "none", borderRadius: 8, padding: "7px 18px",
              fontSize: 12.5, fontWeight: 500, cursor: "pointer", transition: "filter 0.15s",
            }}>确认删除</button>
        </div>
      </div>
    </div>
  );
}