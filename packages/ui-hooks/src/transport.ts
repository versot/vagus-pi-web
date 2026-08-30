import type { Frame } from "@vagus/protocol";
import type { Transport } from "@vagus/ui-shared";

/**
 * Browser WebSocket transport (M4).
 *
 * Implements the same {@link Transport} contract as the stdio client used by
 * the TUI, so the shared {@link JsonRpcClient} works identically over a
 * WebSocket. The daemon listens on `VAGUS_WS_PORT` (default 19707) and speaks
 * the same JSON-RPC 2.0 + event-stream protocol (ADR-003).
 */

export interface WebSocketTransportOptions {
  /** WebSocket URL, e.g. `ws://127.0.0.1:19707`. */
  url: string;
  /** Called once when the connection opens. */
  onOpen?: () => void;
  /** Called on close with the code and reason. */
  onClose?: (code: number, reason: string) => void;
}

export class WebSocketTransport implements Transport {
  private readonly ws: WebSocket;
  private readonly listeners = new Set<(frame: Frame) => void>();
  private readonly onOpen?: () => void;
  private readonly onClose?: (code: number, reason: string) => void;
  /** Frames queued before the WebSocket opens — flushed on connect. */
  private readonly pendingFrames: Frame[] = [];
  private opened = false;

  constructor({ url, onOpen, onClose }: WebSocketTransportOptions) {
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.ws = new WebSocket(url);

    this.ws.addEventListener("open", () => {
      this.opened = true;
      // Flush frames queued before the connection was ready.
      for (const frame of this.pendingFrames) {
        this.ws.send(JSON.stringify(frame));
      }
      this.pendingFrames.length = 0;
      this.onOpen?.();
    });
    this.ws.addEventListener("message", (event: MessageEvent) => {
      try {
        const frame = JSON.parse(String(event.data)) as Frame;
        for (const listener of this.listeners) listener(frame);
      } catch {
        // malformed frame — ignore
      }
    });
    this.ws.addEventListener("close", (event: CloseEvent) => {
      this.onClose?.(event.code, event.reason);
    });
  }

  send(frame: Frame): void {
    if (this.opened || this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    } else {
      // Connection still pending — queue for flush on open.
      this.pendingFrames.push(frame);
    }
  }

  onFrame(callback: (frame: Frame) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  close(): void {
    this.ws.close();
    this.listeners.clear();
  }
}
