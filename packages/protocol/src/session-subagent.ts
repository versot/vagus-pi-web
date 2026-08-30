import { z } from "zod";

/**
 * Subagent lifecycle event (from @tintinweb/pi-subagents bridge).
 *
 * Mirrors the extension's `subagents:*` events on `pi.events` so the GUI can
 * render subagent activity (fleet view, completion states, results) without
 * touching pi internals. Payload is kept loosely typed — the extension owns
 * the shape; Vagus only forwards it.
 */
export const sessionSubagentEvent = z.object({
  type: z.literal("session.subagent"),
  /** Parent Vagus session id (may be missing for session-less events). */
  sessionId: z.string().optional(),
  /** One of: created, started, completed, failed, steered, compacted, ready, scheduled. */
  kind: z.string(),
  /** Subagent id (extension-owned). */
  agentId: z.string().optional(),
  /** Subagent type name (Explore, Plan, ...). */
  agentType: z.string().optional(),
  /** Human description of the task. */
  description: z.string().optional(),
  /** Terminal status (completed/failed/stopped/aborted). */
  status: z.string().optional(),
  /** Final text output (completed/failed). */
  result: z.string().optional(),
  /** Error message (failed). */
  error: z.string().optional(),
  /** Raw payload from the extension, for forward compatibility. */
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type SessionSubagentEvent = z.infer<typeof sessionSubagentEvent>;
