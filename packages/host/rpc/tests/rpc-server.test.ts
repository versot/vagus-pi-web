import { describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "@vagus/protocol";
import type { Frame } from "@vagus/protocol";
import { JsonRpcServer } from "../src/server.js";

function makeServer() {
  const sent: Frame[] = [];
  const server = new JsonRpcServer({ send: (frame) => sent.push(frame) });
  return { server, sent };
}

function request(id: number | null, method: string, params?: unknown): Frame {
  return { type: "request", payload: { jsonrpc: "2.0", id, method, params } };
}

describe("JsonRpcServer", () => {
  it("responds to a registered method", async () => {
    const { server, sent } = makeServer();
    server.registerMethod("ping", () => ({ pong: true }));

    await server.handleFrame(request(1, "ping"));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "response",
      payload: { jsonrpc: "2.0", id: 1, result: { pong: true } },
    });
  });

  it("normalizes undefined results to null (JSON-RPC has no undefined)", async () => {
    const { server, sent } = makeServer();
    server.registerMethod("noop", () => undefined);

    await server.handleFrame(request(1, "noop"));

    expect(sent[0]?.payload).toMatchObject({ id: 1, result: null });
  });

  it("answers unknown methods with -32601", async () => {
    const { server, sent } = makeServer();
    await server.handleFrame(request(1, "nope"));

    expect(sent[0]?.payload).toMatchObject({
      id: 1,
      error: { code: ErrorCodes.MethodNotFound },
    });
  });

  it("answers handler errors with -32603 and the message", async () => {
    const { server, sent } = makeServer();
    server.registerMethod("boom", () => {
      throw new Error("kaboom");
    });

    await server.handleFrame(request(1, "boom"));

    expect(sent[0]?.payload).toMatchObject({
      id: 1,
      error: { code: ErrorCodes.InternalError, message: "kaboom" },
    });
  });

  it("does not respond to notifications", async () => {
    const { server, sent } = makeServer();
    server.registerMethod("ping", () => ({ pong: true }));

    await server.handleFrame(request(null, "ping"));

    expect(sent).toHaveLength(0);
  });

  it("supports async handlers and preserves id correlation", async () => {
    const { server, sent } = makeServer();
    server.registerMethod("slow", async (params) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { received: params };
    });

    await server.handleFrame(request(7, "slow", { n: 1 }));

    expect(sent[0]?.payload).toMatchObject({ id: 7, result: { received: { n: 1 } } });
  });

  it("emits domain events through the send callback", () => {
    const { server, sent } = makeServer();
    server.emit({ type: "session.created", sessionId: "s1", cwd: "/repo" });

    expect(sent[0]).toEqual({
      type: "event",
      payload: {
        type: "event",
        event: { type: "session.created", sessionId: "s1", cwd: "/repo" },
      },
    });
  });

  it("rejects duplicate method registration", () => {
    const { server } = makeServer();
    server.registerMethod("ping", () => ({}));
    expect(() => server.registerMethod("ping", () => ({}))).toThrow(/already registered/);
    void vi;
  });
});
