import { z } from "zod";

/**
 * Queue state broadcast from the pi session — the authoritative list of
 * messages still waiting to be delivered to the agent (steering queue).
 *
 * The GUI renders its queued-messages rail from this event instead of
 * optimistically inserting messages locally, so cancelling never races with
 * pi's internal queue and "fake queued" flashes cannot happen.
 */
export const sessionQueueUpdateEvent = z.object({
  type: z.literal("session.queue_update"),
  sessionId: z.string(),
  /** Messages still waiting in pi's steering queue (in delivery order). */
  steering: z.array(z.string()),
});
export type SessionQueueUpdateEvent = z.infer<typeof sessionQueueUpdateEvent>;
