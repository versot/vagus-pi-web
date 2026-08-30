import { useState } from "react";
import { useAppearance, useTheme, useTokens } from "@vagus/ui-tokens";
import type { AppearanceSettings, ProviderConfigUI, UsageStatsUI } from "@vagus/ui-tokens";
import { ModelsView } from "./models-view.js";
import { AppearanceView } from "./appearance-view.js";
import { UsageView } from "./usage-view.js";
import { McpView } from "./mcp-view.js";
import { SkillsView } from "./skills-view.js";

/**
 * Settings view — two-column: category nav (left) + content (right).
 *
 * Categories: 基础设置 (外观 / 模型设置) · Agents 能力 (MCP, 技能) ·
 * 数据与统计 (使用统计). Each category view lives in its own module
 * (models-view / appearance-view / usage-view) so the settings entry keeps
 * only the shell: nav, category switching and the shared draft/commit flow.
 */

export type Category = "models" | "appearance" | "mcp" | "skills" | "usage";

interface SettingsViewProps {
  providers: ProviderConfigUI[];
  /** Aggregated usage stats (null until the daemon answers). */
  usageStats: UsageStatsUI | null;
  onClose: () => void;
  /** Called with the full provider list whenever the model settings change. */
  onSave: (providers: ProviderConfigUI[]) => Promise<void>;
  /** Re-fetches the model config from the daemon (refresh button). */
  onRefresh: () => void;
  /** Probes a provider endpoint (test connection). */
  onTest: (params: { baseUrl: string; api: string; apiKey?: string; model?: string }) => Promise<{ ok: boolean; status?: number; reason?: "auth" | "model" }>;
  onProbe: (params: { baseUrl: string; api: string; apiKey?: string; model: string }) => Promise<{ ok: boolean; compat?: Record<string, unknown>; input?: string[]; reasoning?: boolean; error?: string }>;
  /** Currently selected settings category (controlled from the host app so it
   *  survives reopening the settings page). */
  cat: Category;
  onCatChange: (cat: Category) => void;
  /** Thin RPC wrapper for plugin/mcp management views. */
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** Active project cwd (for project-scoped MCP configs). */
  projectCwd?: string;
}


export function SettingsView({ providers, usageStats, onClose, onSave, onRefresh, onTest, cat, onCatChange, onProbe, request, projectCwd }: SettingsViewProps): JSX.Element {
  const t = useTokens();
  const appearance = useAppearance();

  // Appearance *font/display* settings are edited as a draft and committed
  // when the user clicks 返回 — the settings page itself does not resize
  // while editing. The theme, however, applies immediately so the user can
  // see the colors change live on the settings page too.
  const [draftSettings, setDraftSettings] = useState<AppearanceSettings>(() => ({
    uiFontSize: appearance.uiFontSize,
    showLineNumbers: appearance.showLineNumbers,
    wrapLongLines: appearance.wrapLongLines,
    codeFontSize: appearance.codeFontSize,
  }));

  const patchDraft = (patch: Partial<AppearanceSettings>): void =>
    setDraftSettings((d) => ({ ...d, ...patch }));

  const commitAndClose = (): void => {
    appearance.update(draftSettings);
    onClose();
  };

  const navItem = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9,
    fontSize: 13, cursor: "pointer",
    background: active ? t.color.surface : "transparent",
    color: active ? t.color.fg : t.color.muted,
    fontWeight: active ? 500 : 400,
  });

  const catLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: t.color.muted,
    padding: "14px 10px 6px", letterSpacing: "0.05em",
  };

  const { theme: settingsTheme } = useTheme();
  const inputStyle: React.CSSProperties = {
    width: "100%", background: settingsTheme === "light" ? "#ffffff" : t.color.surface, border: `1px solid ${t.color.border}`,
    borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", color: t.color.fg,
  };

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, background: t.color.bg, fontSize: 14 }}>
      {/* Left: categories */}
      <aside style={{
        width: 220, flexShrink: 0, borderRight: `1px solid ${t.color.border}`,
        padding: "20px 12px", display: "flex", flexDirection: "column", gap: 4, overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 14px" }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: t.color.fg }}>设置</span>
          <button onClick={commitAndClose} style={{ marginLeft: "auto", border: "none", background: "none", color: t.color.muted, fontSize: 12, cursor: "pointer" }}>← 返回</button>
        </div>

        <div style={catLabel}>基础设置</div>
        <div style={navItem(cat === "appearance")} onClick={() => onCatChange("appearance")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
          外观
        </div>

        <div style={navItem(cat === "models")} onClick={() => onCatChange("models")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><circle cx="12" cy="12" r="3"/></svg>
          模型设置
        </div>

        <div style={catLabel}>Agents 能力</div>
        <div style={navItem(cat === "mcp")} onClick={() => onCatChange("mcp")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>
          MCP 服务器
        </div>
        <div style={navItem(cat === "skills")} onClick={() => onCatChange("skills")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L3 18v3h3l5.3-5.3a4.5 4.5 0 0 0 6.4-6.4l-3 3-2.3-2.3 3-3z"/></svg>
          技能
        </div>

        <div style={catLabel}>数据与统计</div>
        <div style={navItem(cat === "usage")} onClick={() => onCatChange("usage")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>
          使用统计
        </div>
      </aside>

      {/* Right: content */}
      <main style={{ flex: 1, overflowY: "auto", minWidth: 0, padding: "28px 36px 60px", scrollbarGutter: "stable" }}>
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          {cat === "usage" && <UsageView stats={usageStats} t={t} />}
          {cat === "models" && <ModelsView providers={providers} inputStyle={inputStyle} t={t} onSave={onSave} onRefresh={onRefresh} onTest={onTest} onProbe={onProbe} />}
          {cat === "appearance" && (
            <AppearanceView
              draft={draftSettings}
              onChange={patchDraft}
              t={t}
            />
          )}
          {cat === "mcp" && <McpView request={request} t={t} />}
          {cat === "skills" && <SkillsView request={request} t={t} />}
        </div>
      </main>
    </div>
  );
}
