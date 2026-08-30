import type {
  SessionEvent,
  SessionMessageEvent,
  SessionThinkingEvent,
  SessionToolCallEvent,
  SessionToolResultEvent,
  SessionSubagentEvent,
} from "@vagus/protocol";

/**
 * Core event map — the typed surface the engine emits on its {@link EventBus}.
 *
 * Wire schemas for these events live in `@vagus/protocol`; this module only
 * narrows them for engine-internal subscribers (and for the daemon's
 * forwarding loop, which re-encodes them into protocol frames).
 */
export interface CoreEventMap {
  "session.created": Extract<SessionEvent, { type: "session.created" }>;
  "session.closed": Extract<SessionEvent, { type: "session.closed" }>;
  "session.message": SessionMessageEvent;
  "session.thinking": SessionThinkingEvent;
  "session.tool_call": SessionToolCallEvent;
  "session.tool_result": SessionToolResultEvent;
  "session.subagent": SessionSubagentEvent;
  /** Allows the map to grow as managers land. */
  [name: string]: unknown;
}
