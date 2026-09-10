import { useCallback, useEffect, useRef, useState } from "react";
import { JsonRpcClient } from "@vagus/ui-shared";
import type { DomainEvent, Transport } from "@vagus/ui-shared";
import { WebSocketTransport } from "./transport.js";

/** Daemon WebSocket endpoint (same port as the web UI). */
const WS_URL = `ws://${location.host}`;

/**
 * Manages the WebSocket connection and JSON-RPC client.
 *
 * Events are dispatched via `onEvent` — register a handler that receives
 * every domain event from the daemon. The ref is updated on every render so
 * the handler always has the latest React state in its closure.
 */
export function useVagusClient(injectedTransport?: Transport) {
  const [client, setClient] = useState<JsonRpcClient | null>(null);
  const clientRef = useRef<JsonRpcClient | null>(null);
  const onEventRef = useRef<(event: DomainEvent) => void>(() => {});

  /** Register (or update) the event handler. Call on every render. */
  const registerOnEvent = useCallback((fn: (event: DomainEvent) => void) => {
    onEventRef.current = fn;
  }, []);

  useEffect(() => {
    let disposed = false;
    let transport: Transport | undefined;
    let c: JsonRpcClient | undefined;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    // Reconnect with capped backoff. App-level effects keyed on [client]
    // re-run on the fresh client, restoring session/info/history state.
    const connect = (): void => {
      if (disposed) return;
      transport = injectedTransport ?? new WebSocketTransport({
        url: WS_URL,
        onOpen: () => { retry = 0; },
        onClose: () => {
          if (disposed) return;
          c?.close(); // fail in-flight requests fast instead of hanging 5min
          retry = Math.min(retry + 1, 4);
          reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** retry, 8000));
        },
      });
      c = new JsonRpcClient(transport);
      setClient(c);
      clientRef.current = c;
      c.onEvent((event: DomainEvent) => {
        onEventRef.current(event);
      });
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      c?.close();
    };
  }, [injectedTransport]); // eslint-disable-line react-hooks/exhaustive-deps

  return { client, registerOnEvent, clientRef };
}