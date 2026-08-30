import { useState } from "react";
import { useTheme, useTokens } from "@vagus/ui-tokens";
import { InputBar } from "@vagus/ui-input";
import type { CommandInfo, SessionUsage } from "@vagus/ui-input";
import type { ProviderConfigUI } from "@vagus/ui-tokens";

/**
 * The shared message input card, used on both the welcome and chat panes.
 * The only difference is visual: welcome gets the brand-glow focus ring,
 * the chat pane a more compact card.
 */
export interface InputCardProps {
  variant: "welcome" | "chat";
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  usage: SessionUsage | null;
  providers: ProviderConfigUI[];
  onSwitchModel: (providerId: string, modelId: string) => void;
  onSetThinking: (level: string) => void;
  thinkingLevel?: string;
  permissionMode: "ask" | "auto";
  onTogglePermission: () => void;
  attachments?: Array<{ dataUrl: string; mimeType: string; name?: string }>;
  fileAttachments?: Array<{ name: string; content: string }>;
  onAttach?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  onCommand?: () => void;
  /** All slash commands for the inline "/" autocomplete. */
  commands?: CommandInfo[];
  /** Insert a picked command into the input (called by the inline dropdown). */
  onPickCommand?: (command: string) => void;
  /** Re-fetch the command palette (called when "/" is typed / picker opened). */
  onRefreshCommands?: () => void;
  /** When this number changes, focus the input (session switch / returning from settings). */
  focusSignal?: number;
  /** A ctx.ui dialog is awaiting a response — the send button becomes a dialog button. */
  hasPendingDialog?: boolean;
  onRestoreDialog?: () => void;
  busy?: boolean;
  onStop?: () => void;
  selectedModel?: string;
  queuedMessages?: Array<{ id: number; text: string }>;
}

export function InputCard(props: InputCardProps): JSX.Element {
  const t = useTokens();
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const welcome = props.variant === "welcome";
  /** Input card surface: pure white on light theme, token surface on dark. */
  const bg = theme === "light" ? "#ffffff" : t.color.surface;

  return (
    <div className="vagus-input-card"
      style={{
        background: bg,
        border: `1px solid ${welcome ? (focused ? "rgba(99,102,241,0.55)" : t.color.border) : t.color.border}`,
        borderRadius: welcome ? 22 : 18,
        boxShadow: welcome
          ? focused
            ? "0 8px 40px rgba(99,102,241,0.12), 0 0 0 4px rgba(99,102,241,0.08)"
            : "0 6px 28px rgba(0,0,0,0.05)"
          : undefined,
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        // Welcome card: breathing glow animation when not focused.
        animation: welcome && !focused ? "vagus-breath 3s ease-in-out infinite" : undefined,
        display: "flex", flexDirection: "column",
        padding: welcome ? "20px 24px 14px" : "14px 18px 10px",
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseDown={(e) => {
        // 输入卡空白区域（padding）不可点击——只允许 textarea 和控件响应
        const el = e.target as HTMLElement;
        if (!el.closest("button, input, textarea, select, [contenteditable], [role='button']")) e.preventDefault();
      }}
    >
      <InputBar
        value={props.value}
        onChange={props.onChange}
        onSubmit={props.onSubmit}
        usage={props.usage}
        providers={props.providers}
        onSwitchModel={props.onSwitchModel}
        onSetThinking={props.onSetThinking}
        thinkingLevel={props.thinkingLevel}
        permissionMode={props.permissionMode}
        onTogglePermission={props.onTogglePermission}
        attachments={props.attachments}
        fileAttachments={props.fileAttachments}
        onAttach={props.onAttach}
        onRemoveAttachment={props.onRemoveAttachment}
        busy={props.busy}
        onStop={props.onStop}
        selectedModel={props.selectedModel}
        onCommand={props.onCommand}
        commands={props.commands}
        onPickCommand={props.onPickCommand}
        onRefreshCommands={props.onRefreshCommands}
        focusSignal={props.focusSignal}
        hasPendingDialog={props.hasPendingDialog}
        onRestoreDialog={props.onRestoreDialog}
        queuedMessages={props.queuedMessages}
      />
    </div>
  );
}
