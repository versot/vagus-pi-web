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
    const transport = injectedTransport ?? new WebSocketTransport({ url: WS_URL, onOpen: () => {} });
    const c = new JsonRpcClient(transport);
    setClient(c);
    clientRef.current = c;

    // Reconnect/cleanup: when the hook unmounts the transport is closed;
    // the JsonRpcClient is discarded and the event handler cleaned up.
    const unsubscribe = c.onEvent((event: DomainEvent) => {
      onEventRef.current(event);
    });

    return () => {
      unsubscribe();
      transport.close();
    };
  }, [injectedTransport]); // eslint-disable-line react-hooks/exhaustive-deps

  return { client, registerOnEvent, clientRef };
}