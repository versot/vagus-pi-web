import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonRpcServer } from "../src/server.js";
import { WsServerHost } from "../src/websocket-server.js";

/**
 * M4 integration: the daemon serves the built GUI over HTTP *and* the
 * JSON-RPC event stream over WebSocket on the same port (one process, one
 * port — ADR-003 + the static UI server). Uses the **native** WebSocket
 * client (Node 22+) so the tests exercise exactly the protocol surface the
 * browser GUI uses; the `ws`-package path is covered by e2e/websocket.e2e.ts.
 */

const hosts: WsServerHost[] = [];

function freePort(): number {
  return 24000 + Math.floor(Math.random() * 5000);
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = globalThis.fetch(`http://127.0.0.1:${port}${path}`);
    req
      .then(async (res) => resolve({ status: res.status, body: await res.text() }))
      .catch(reject);
  });
}

afterEach(() => {
  for (const host of hosts) host.close();
  hosts.length = 0;
});

describe("WsServerHost with staticDir", () => {
  it("serves the web UI and the JSON-RPC stream on one port", async () => {
    const root = mkdtempSync(join(tmpdir(), "vagus-ws-static-"));
    writeFileSync(join(root, "index.html"), "<html><body>vagus ui</body></html>");

    const port = freePort();
    const host = new WsServerHost();
    hosts.push(host);
    host.listen({
      port,
      registerMethods: (server: JsonRpcServer) => {
        server.registerMethod("ping", () => ({ pong: true }));
      },
      staticDir: root,
    });

    // HTTP: the static UI is served on the same port.
    const page = await httpGet(port, "/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("vagus ui");

    // WebSocket: upgrades work on the same HTTP server.
    const ws = await connect(`ws://127.0.0.1:${port}`);
    const reply = new Promise<unknown>((resolve) => {
      ws.addEventListener("message", (ev: MessageEvent) => {
        const frame = JSON.parse(String(ev.data));
        if (frame?.type === "response" && frame.payload?.id === 1) resolve(frame.payload);
      });
    });
    ws.send(JSON.stringify({ type: "request", payload: { jsonrpc: "2.0", id: 1, method: "ping", params: {} } }));
    const payload = (await reply) as { result?: unknown };
    expect(payload.result).toEqual({ pong: true });
    ws.close();
  });

  it("still opens a bare WebSocket server when staticDir is missing", async () => {
    const port = freePort();
    const host = new WsServerHost();
    hosts.push(host);
    host.listen({
      port,
      registerMethods: (server: JsonRpcServer) => {
        server.registerMethod("ping", () => ({ pong: true }));
      },
      staticDir: join(tmpdir(), "vagus-does-not-exist"),
    });

    const ws = await connect(`ws://127.0.0.1:${port}`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
