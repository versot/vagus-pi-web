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
  /** Heartbeat: macOS sleep / NAT timeouts silently sever the TCP link while
   *  readyState stays OPEN — a send into that dead socket vanishes with no
   *  error and no close event. A ping every 25s detects it: no pong within
   *  10s ⇒ force onClose so the client can reconnect and flush queued sends. */
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private closedNotified = false;

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
      this.startHeartbeat();
      this.onOpen?.();
    });
    this.ws.addEventListener("message", (event: MessageEvent) => {
      try {
        const raw = JSON.parse(String(event.data)) as { type?: string };
        if (raw.type === "pong") {
          if (this.pongTimer) clearTimeout(this.pongTimer);
          return;
        }
        const frame = raw as Frame;
        for (const listener of this.listeners) listener(frame);
      } catch {
        // malformed frame — ignore
      }
    });
    this.ws.addEventListener("close", (event: CloseEvent) => {
      this.stopHeartbeat();
      this.notifyClosed(event.code, event.reason);
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.ws.send(JSON.stringify({ type: "ping" }));
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        // No pong — the link is dead even though readyState says OPEN.
        this.stopHeartbeat();
        this.ws.close();
        this.notifyClosed(4000, "heartbeat timeout");
      }, 10_000);
    }, 25_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.heartbeatTimer = undefined;
    this.pongTimer = undefined;
  }

  private notifyClosed(code: number, reason: string): void {
    if (this.closedNotified) return;
    this.closedNotified = true;
    this.onClose?.(code, reason);
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
    this.stopHeartbeat();
    this.ws.close();
    this.listeners.clear();
  }
}
