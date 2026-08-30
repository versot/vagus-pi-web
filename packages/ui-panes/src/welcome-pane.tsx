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
}): JSX.Element {
  const t = useTokens();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 760, margin: "0 auto", padding: "32px 28px", display: "flex", flexDirection: "column" }}>
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
          <InputCard {...props.inputCard} variant="welcome" />
        </div>
      </div>
    </div>
  );
}