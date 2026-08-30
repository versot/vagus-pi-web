import { ErrorCodes } from "@vagus/protocol";
import type { DomainEvent, Frame, JsonRpcResponse } from "@vagus/protocol";

/**
 * Transport abstraction: how a frame reaches the daemon.
 *
 * Two concrete transports exist (M1): stdio JSONL for the TUI, WebSocket for
 * the GUI browser. Both implement this interface; the client is transport-
 * agnostic (ADR-003).
 */
export interface Transport {
  /** Sends a single frame to the daemon. */
  send(frame: Frame): void;
  /** Registers a frame callback; returns an unsubscribe function. */
  onFrame(callback: (frame: Frame) => void): () => void;
  /** Tears down the transport. */
  close(): void;
}

export interface JsonRpcClientOptions {
  /** Timeout for a single request, in ms. Defaults to 30s. */
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Minimal JSON-RPC 2.0 client with typed framing and request timeouts.
 *
 * The client is the only piece of UI-facing networking: both the TUI and the
 * GUI render from the same event stream and issue the same requests, so a bug
 * in the protocol layer surfaces in exactly one place.
 */
export class JsonRpcClient {
  private nextId = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<(event: DomainEvent) => void>();
  private readonly requestTimeoutMs: number;
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly transport: Transport,
    options: JsonRpcClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 300_000;
    this.unsubscribe = transport.onFrame((frame) => this.handleFrame(frame));
  }

  /**
   * Sends a request and resolves with the server's `result`.
   * Rejects on protocol errors, server errors, or timeout.
   */
  request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error("client is closed"));
    }
    const id = this.nextId++;
    const key = String(id);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`request timed out: ${method}`));
      }, this.requestTimeoutMs);

      this.pending.set(key, { resolve, reject, timer });
      this.transport.send({
        type: "request",
        payload: { jsonrpc: "2.0", id, method, params },
      });
    });
  }

  /** Sends a notification (no response expected). */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.transport.send({
      type: "request",
      payload: { jsonrpc: "2.0", id: null, method, params },
    });
  }

  /** Subscribes to daemon-pushed domain events; returns an unsubscribe fn. */
  onEvent(listener: (event: DomainEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Closes the client and fails any in-flight requests. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("client closed"));
    }
    this.pending.clear();
    this.transport.close();
  }

  private handleFrame(frame: Frame): void {
    if (frame.type === "event") {
      for (const listener of this.eventListeners) {
        listener(frame.payload.event);
      }
      return;
    }
    if (frame.type !== "response") return;
    const key = String(frame.payload.id);
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    clearTimeout(pending.timer);
    this.settle(pending, frame.payload);
  }

  private settle(pending: PendingRequest, response: JsonRpcResponse): void {
    if (response.error) {
      const error = new Error(
        `${response.error.message} (code ${response.error.code})`,
      );
      if (response.error.data !== undefined) {
        (error as Error & { data?: unknown }).data = response.error.data;
      }
      pending.reject(error);
      return;
    }
    pending.resolve(response.result);
  }
}

/** Error code re-export for client-side checks (e.g. timeout handling). */
export { ErrorCodes };
