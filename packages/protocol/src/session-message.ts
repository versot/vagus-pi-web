import { z } from "zod";

/**
 * Session message events (M3): pi's assistant stream, forwarded to UIs.
 *
 * The pi host subscribes to its AgentSession and re-emits text chunks as
 * protocol events, so both the TUI and the GUI render assistant responses
 * without ever touching pi internals.
 */

export const sessionMessageEvent = z.object({
  type: z.literal("session.message"),
  sessionId: z.string(),
  kind: z.enum(["text_delta", "text_done", "user_queued", "error"]),
  text: z.string(),
  /** Image attachments on a user message (data URLs, ready for <img src>). */
  images: z.array(z.object({ dataUrl: z.string(), mimeType: z.string() })).optional(),
});
export type SessionMessageEvent = z.infer<typeof sessionMessageEvent>;
