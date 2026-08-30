import { z } from "zod";
import { JsonRpcRequest, JsonRpcResponse } from "./jsonrpc.js";
import { EventEnvelope } from "./events.js";

/**
 * Frame-level envelope. Every message on the wire is one of three frames;
 * `type` is the discriminated union key, so parsers can dispatch without
 * deep validation first.
 */
export const RequestFrame = z.object({
  type: z.literal("request"),
  payload: JsonRpcRequest,
});
export type RequestFrame = z.infer<typeof RequestFrame>;

export const ResponseFrame = z.object({
  type: z.literal("response"),
  payload: JsonRpcResponse,
});
export type ResponseFrame = z.infer<typeof ResponseFrame>;

export const EventFrame = z.object({
  type: z.literal("event"),
  payload: EventEnvelope,
});
export type EventFrame = z.infer<typeof EventFrame>;

export const Frame = z.discriminatedUnion("type", [
  RequestFrame,
  ResponseFrame,
  EventFrame,
]);
export type Frame = z.infer<typeof Frame>;
