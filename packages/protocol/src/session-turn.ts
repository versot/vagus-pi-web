import { z } from "zod";

/**
 * Turn lifecycle events (turn_start / turn_end projected from the pi session).
 *
 * The GUI uses these to flip its busy state — the send button becomes a stop
 * button while the agent is working.
 */
export const sessionTurnEvent = z.object({
  type: z.literal("session.turn"),
  sessionId: z.string(),
  kind: z.enum(["start", "end"]),
  /** True when the run ended with an error/abort — the UI keeps the work
   *  block open so the user can inspect where it failed. */
  errored: z.boolean().optional(),
});
export type SessionTurnEvent = z.infer<typeof sessionTurnEvent>;
