import { z } from "zod";
import { sessionMessageEvent } from "./session-message.js";
import { sessionQueueUpdateEvent } from "./session-queue.js";
import { sessionThinkingEvent } from "./session-thinking.js";
import { sessionToolCallEvent, sessionToolResultEvent } from "./session-tool.js";
import { sessionTurnEvent } from "./session-turn.js";
import { sessionSubagentEvent } from "./session-subagent.js";

/**
 * Domain event schemas pushed from the core engine to subscribed frontends.
 *
 * Events are the "single source of truth" projection: every state transition
 * in the core is emitted as an event, and UIs render purely from the event
 * stream (see ADR-003 / ADR-010). Session events are the pi session's own
 * lifecycle projected onto the wire.
 */

/** Session lifecycle events. */
const sessionCreated = z.object({
  type: z.literal("session.created"),
  sessionId: z.string(),
  cwd: z.string(),
});
const sessionClosed = z.object({
  type: z.literal("session.closed"),
  sessionId: z.string(),
});

/** Session lifecycle events, narrowed for session-specific consumers. */
export const sessionEvent = z.discriminatedUnion("type", [sessionCreated, sessionClosed]);
export type SessionEvent = z.infer<typeof sessionEvent>;

/** Union of all domain events. */
export const domainEvent = z.discriminatedUnion("type", [
  sessionCreated,
  sessionClosed,
  sessionMessageEvent,
  sessionQueueUpdateEvent,
  sessionThinkingEvent,
  sessionToolCallEvent,
  sessionToolResultEvent,
  sessionTurnEvent,
  sessionSubagentEvent,
]);
export type DomainEvent = z.infer<typeof domainEvent>;

/** Envelope that carries a domain event over a transport. */
export const EventEnvelope = z.object({
  type: z.literal("event"),
  event: domainEvent,
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export * from "./session-message.js";
export * from "./session-queue.js";
export * from "./session-thinking.js";
export * from "./session-tool.js";
export * from "./session-turn.js";
export * from "./session-subagent.js";
