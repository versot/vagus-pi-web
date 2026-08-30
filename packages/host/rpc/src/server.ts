import { ErrorCodes, makeError } from "@vagus/protocol";
import type { DomainEvent, Frame, JsonRpcError, JsonRpcId } from "@vagus/protocol";

/**
 * JSON-RPC 2.0 server (ADR-003).
 *
 * Transport-agnostic: the daemon feeds frames from a {@link StdioTransport}
 * (or, later, a WebSocket) into {@link handleFrame} and sends every outgoing
 * frame through the `send` callback. Notifications (`id: null`) never produce
 * a response; unknown methods produce a standard -32601 error.
 */

export type MethodHandler = (params: unknown) => unknown | Promise<unknown>;

export interface JsonRpcServerOptions {
  /** Outgoing frame sink (the transport). */
  send: (frame: Frame) => void;
}

export class JsonRpcServer {
  private readonly methods = new Map<string, MethodHandler>();

  constructor(private readonly options: JsonRpcServerOptions) {}

  /** Registers a method; duplicate registration is a programming error. */
  registerMethod(name: string, handler: MethodHandler): void {
    if (this.methods.has(name)) {
      throw new Error(`method already registered: ${name}`);
    }
    this.methods.set(name, handler);
  }

  /**
   * Processes one inbound frame. Requests are dispatched sequentially so
   * notifications and responses keep their arrival order (callers await this).
   */
  async handleFrame(frame: Frame): Promise<void> {
    if (frame.type !== "request") return; // responses/events are never client→daemon
    const { id, method, params } = frame.payload;
    if (id === null) {
      await this.runHandler(method, params, null);
      return;
    }
    await this.runHandler(method, params, id);
  }

  /** Pushes a domain event to connected clients. */
  emit(event: DomainEvent): void {
    this.options.send({ type: "event", payload: { type: "event", event } });
  }

  private async runHandler(method: string, params: unknown, id: JsonRpcId): Promise<void> {
    const handler = this.methods.get(method);
    if (!handler) {
      if (id !== null) {
        this.respond(id, undefined, makeError(ErrorCodes.MethodNotFound, `method not found: ${method}`));
      }
      return;
    }
    try {
      const result = await handler(params);
      if (id !== null) this.respond(id, result);
    } catch (error) {
      if (id !== null) {
        const message = error instanceof Error ? error.message : String(error);
        this.respond(id, undefined, makeError(ErrorCodes.InternalError, message));
      }
    }
  }

  private respond(id: JsonRpcId, result: unknown, error?: JsonRpcError): void {
    const payload = error
      ? { jsonrpc: "2.0" as const, id, error }
      // JSON-RPC has no `undefined` value: normalize to null so the frame
      // stays schema-valid on the wire.
      : { jsonrpc: "2.0" as const, id, result: result === undefined ? null : result };
    this.options.send({ type: "response", payload });
  }
}
