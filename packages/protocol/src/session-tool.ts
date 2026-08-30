import { z } from "zod";

/**
 * Session tool-call events (M4b): pi's tool executions, forwarded to UIs.
 *
 * pi's AgentSession emits `tool_execution_start` / `tool_execution_end` for
 * every tool call (bash, read, edit, write, dispatch, …). The pi host
 * re-emits them as protocol events so the GUI can render Codex-style inline
 * tool cards — the user sees *what* ran and *what came back*, not just the
 * final assistant text.
 *
 * `toolCallId` correlates the call with its result (pi's `toolCallId`).
 */

export const sessionToolCallEvent = z.object({
  type: z.literal("session.tool_call"),
  sessionId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  /** Serialized arguments (JSON), truncated for display. */
  args: z.string(),
});
export type SessionToolCallEvent = z.infer<typeof sessionToolCallEvent>;

export const sessionToolResultEvent = z.object({
  type: z.literal("session.tool_result"),
  sessionId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  /** Serialized result text, truncated for display. */
  result: z.string(),
  /** File-edit diff (pi's display format, `+/ -/ space` lines) — present for
   *  edit tools so UIs can render a Claude-Code-style red/green diff. */
  diff: z.string().optional(),
  /** Unified patch (git-style) for the edit — reverse-appliable to revert. */
  patch: z.string().optional(),
  isError: z.boolean(),
});
export type SessionToolResultEvent = z.infer<typeof sessionToolResultEvent>;
