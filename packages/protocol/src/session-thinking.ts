import { z } from "zod";

/**
 * Session thinking events (M4b): pi's reasoning stream, forwarded to UIs.
 *
 * pi's AssistantMessageEvent includes `thinking_delta` / `thinking_end` in
 * the message_update stream. The pi host re-emits them as protocol events so
 * the GUI can render a Codex-style collapsible thinking card — shown while
 * the model is reasoning, auto-collapsed when text generation starts.
 */

export const sessionThinkingEvent = z.object({
  type: z.literal("session.thinking"),
  sessionId: z.string(),
  kind: z.enum(["delta", "done"]),
  text: z.string(),
});
export type SessionThinkingEvent = z.infer<typeof sessionThinkingEvent>;