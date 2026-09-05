import { useTokens } from "@vagus/ui-tokens";
import { ProjectSelector } from "@vagus/ui-input";
import type { ProjectOption } from "@vagus/ui-input";
import { InputCard } from "./input-card.js";
import type { InputCardProps } from "./input-card.js";

/**
 * The welcome / landing view: brand greeting, project selector, and the
 * message input card (first-message flow). Shown when no session is active.
 */
export function WelcomePane(props: {
  activeProject?: string;
  projects: ProjectOption[];
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  inputCard: Omit<InputCardProps, "variant">;
  /** Extension status texts to show ABOVE the input bar (ctx.ui.setStatus). */
  aboveEditorStatuses?: Record<string, string>;
  /** Extension widgets to show ABOVE the input bar (placement="aboveEditor"). */
  aboveEditorWidgets?: Record<string, { lines: string[] }>;
  /** Sidebar is collapsed — widen the content's max width to use the space. */
  wide?: boolean;
}): JSX.Element {
  const t = useTokens();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: props.wide ? 900 : 760, margin: "0 auto", padding: "32px 28px", display: "flex", flexDirection: "column" }}>
        {/* 品牌问候区 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22, userSelect: "none" }}>
          <div style={{
            width: 46, height: 46, borderRadius: 14,
            background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 21, fontWeight: 700,
            boxShadow: "0 6px 24px rgba(99,102,241,0.35)",
          }}>◈</div>
          <div style={{ fontSize: "1.4em", fontWeight: 700, color: t.color.fg, marginTop: 12, letterSpacing: "-0.01em" }}>vagusPI</div>
          <div style={{ fontSize: "0.92em", color: t.color.muted, marginTop: 5 }}>
            你的编码智能体工作台 —— 发送第一条消息开始新的对话
          </div>
        </div>
        <ProjectSelector
          projects={props.projects}
          value={props.activeProject}
          onChange={props.onSelectProject}
          onNewProject={props.onNewProject}
        />
        <div style={{ marginTop: 10 }}>
          {(() => {
            const statusEntries = Object.entries(props.aboveEditorStatuses ?? {}).filter(([, text]) => text.length > 0);
            const widgetEntries = Object.entries(props.aboveEditorWidgets ?? {}).filter(([, w]) => w.lines.length > 0);
            if (statusEntries.length === 0 && widgetEntries.length === 0) return null;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {statusEntries.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {statusEntries.map(([key, text]) => (
                      <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999, background: t.color.surface, border: `1px solid ${t.color.border}`, fontSize: "0.8em", color: t.color.fg }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: t.color.primary }} />
                        <span style={{ color: t.color.muted, fontWeight: 600 }}>{key}</span>
                        <span>{text}</span>
                      </span>
                    ))}
                  </div>
                )}
                {widgetEntries.map(([key, w]) => (
                  <div key={key} style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: "0.8em", color: t.color.muted, alignItems: "center", justifyContent: "center" }}>
                    {w.lines.map((line, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{line}</span>
                    ))}
                  </div>
                ))}
              </div>
            );
          })()}
          <InputCard {...props.inputCard} variant="welcome" />
        </div>
      </div>
    </div>
  );
}