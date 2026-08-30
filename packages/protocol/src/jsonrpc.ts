import { z } from "zod";

/**
 * JSON-RPC 2.0 primitives shared by every Vagus transport.
 *
 * The wire contract is schema-first: schemas in this package are the single
 * source of truth for both the core engine (host) and every frontend (client).
 * See `docs/protocol.md` for the transport and versioning policy.
 */

export const JSONRPC_VERSION = "2.0" as const;

/** Standard JSON-RPC error codes (subset used by Vagus). */
export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** Vagus-specific: request timed out client-side. */
  Timeout: -32000,
} as const;

export const JsonRpcId = z.union([z.string(), z.number(), z.null()]);
export type JsonRpcId = z.infer<typeof JsonRpcId>;

/** A client-to-server call. `id: null` is a notification (no response). */
export const JsonRpcRequest = z.object({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: JsonRpcId,
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequest>;

export const JsonRpcError = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type JsonRpcError = z.infer<typeof JsonRpcError>;

/**
 * A server response. Exactly one of `result` or `error` must be present;
 * enforced at the schema level so malformed responses fail fast on both sides.
 */
export const JsonRpcResponse = z
  .object({
    jsonrpc: z.literal(JSONRPC_VERSION),
    id: JsonRpcId,
    result: z.unknown().optional(),
    error: JsonRpcError.optional(),
  })
  .superRefine((value, ctx) => {
    const hasResult = "result" in value;
    const hasError = value.error !== undefined;
    if (hasResult === hasError) {
      ctx.addIssue({
        code: "custom",
        message: "exactly one of `result` or `error` must be present",
      });
    }
  });
export type JsonRpcResponse = z.infer<typeof JsonRpcResponse>;

/** Builds a typed error object, useful for shared error factories. */
export function makeError(code: number, message: string, data?: unknown): JsonRpcError {
  return data === undefined ? { code, message } : { code, message, data };
}
