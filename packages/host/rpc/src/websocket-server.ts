import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { WebSocketServer as WsServer, type WebSocket } from "ws";
import { createStaticHandler } from "./static-server.js";
import { JsonRpcServer } from "./server.js";
import type { DomainEvent, Frame } from "@vagus/protocol";

/**
 * Multi-client WebSocket transport for the JSON-RPC server (ADR-003).
 *
 * Each WebSocket connection gets its own {@link JsonRpcServer} instance,
 * sharing the same method handlers via a factory function. Events from the
 * engine are broadcast to every connected client.
 */

export interface WebSocketServerOptions {
  /** TCP port to listen on (default 19707). */
  port: number;
  /**
   * Called for each new connection to register the same methods that the
   * stdio server uses. The server is already wired to the WebSocket — the
   * factory just calls `server.registerMethod(...)`.
   */
  registerMethods: (server: JsonRpcServer) => void;
  /**
   * Optional directory of static files (the built GUI) served over HTTP on
   * the *same* port, with WebSocket upgrades handled on that HTTP server.
   * One process, one port: the browser loads the UI and attaches to the
   * event stream with no extra infrastructure.
   */
  staticDir?: string;
}

/**
 * Thin wrapper around the `ws` WebSocket server.
 *
 * Lifecycle: create → start via `listen()` → stop via `close()`.
 */
export class WsServerHost {
  private wss: WsServer | undefined;
  private httpServer: Server | undefined;
  private readonly connections = new Set<JsonRpcServer>();

  /** Starts the WebSocket server (optionally serving static files alongside). */
  listen(options: WebSocketServerOptions): void {
    const { port, registerMethods, staticDir } = options;
    try {
      if (staticDir !== undefined) {
        if (!existsSync(staticDir)) {
          // eslint-disable-next-line no-console
          console.error(`vagus: GUI directory not found: ${staticDir} (build the UI first)`);
          this.httpServer = undefined;
          this.wss = new WsServer({ port });
        } else {
          // Serve the web UI and accept WebSocket upgrades on the same HTTP server.
          this.httpServer = createServer(createStaticHandler(staticDir));
          this.wss = new WsServer({ server: this.httpServer });
        }
      } else {
        this.wss = new WsServer({ port });
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("vagus: WebSocket server failed to start:", (error as Error).message);
      return;
    }
    if (this.httpServer) {
      this.httpServer.listen(port, () => {
        // eslint-disable-next-line no-console
        console.error(`vagus: serving web UI + WebSocket on http://127.0.0.1:${port}`);
      });
    } else {
      this.wss.on("listening", () => {
        // eslint-disable-next-line no-console
        console.error(`vagus: WebSocket server listening on ws://127.0.0.1:${port}`);
      });
    }
    this.wss.on("error", (error) => {
      // eslint-disable-next-line no-console
      console.error("vagus: WebSocket server error:", error.message);
    });

    this.wss.on("connection", (ws: WebSocket) => {
      const server = new JsonRpcServer({
        send: (frame: Frame) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(frame));
          }
        },
      });

      registerMethods(server);
      this.connections.add(server);

      ws.on("message", (raw: Buffer) => {
        try {
          const frame = JSON.parse(raw.toString()) as Frame;
          void server.handleFrame(frame);
        } catch {
          // malformed JSON — ignore
        }
      });

      ws.on("close", () => {
        this.connections.delete(server);
      });
    });
  }

  /** Broadcasts a domain event to every connected client. */
  broadcast(event: DomainEvent): void {
    for (const server of this.connections) {
      server.emit(event);
    }
  }

  /** Shuts down the server and drops all connections. */
  close(): void {
    this.wss?.close();
    this.httpServer?.close();
    this.connections.clear();
  }
}