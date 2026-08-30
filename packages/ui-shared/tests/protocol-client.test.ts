import { describe, expect, it, vi } from "vitest";
import type { Frame } from "@vagus/protocol";
import { ErrorCodes, JsonRpcClient } from "../src/protocol-client.js";
import type { Transport } from "../src/protocol-client.js";

/** In-memory transport capturing sent frames; frames can be pushed manually. */
class FakeTransport implements Transport {
  sent: Frame[] = [];
  listeners = new Set<(frame: Frame) => void>();

  send(frame: Frame): void {
    this.sent.push(frame);
  }

  onFrame(callback: (frame: Frame) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  close(): void {
    this.listeners.clear();
  }

  push(frame: Frame): void {
    for (const listener of this.listeners) listener(frame);
  }
}

function response(id: number, result: unknown): Frame {
  return { type: "response", payload: { jsonrpc: "2.0", id, result } };
}

function errorResponse(id: number, message: string, code = ErrorCodes.InternalError): Frame {
  return { type: "response", payload: { jsonrpc: "2.0", id, error: { code, message } } };
}

describe("JsonRpcClient", () => {
  it("sends a request frame with an id and method", () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);
    void client.request("session.list");

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ type: "request" });
    const payload = transport.sent[0]?.payload;
    expect(payload).toMatchObject({ jsonrpc: "2.0", method: "session.list" });
    expect(payload?.id).toBeTypeOf("number");
  });

  it("resolves when the matching response arrives", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);
    const promise = client.request("session.list");
    transport.push(response(0, ["a", "b"]));

    await expect(promise).resolves.toEqual(["a", "b"]);
  });

  it("rejects when the server returns an error", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);
    const promise = client.request("session.list");
    transport.push(errorResponse(0, "nope", ErrorCodes.MethodNotFound));

    await expect(promise).rejects.toThrow(/nope/);
  });

  it("matches responses to the right pending request", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);
    const first = client.request("a");
    const second = client.request("b");

    transport.push(response(1, "second"));
    transport.push(response(0, "first"));

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("rejects on timeout", async () => {
    vi.useFakeTimers();
    try {
      const transport = new FakeTransport();
      const client = new JsonRpcClient(transport, { requestTimeoutMs: 1_000 });
      const promise = client.request("slow");
      // Attach the rejection handler before advancing timers so vitest's
      // unhandled-rejection tracking never sees the timeout rejection.
      const assertion = expect(promise).rejects.toThrow(/timed out/);

      await vi.advanceTimersByTimeAsync(1_100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends notifications without awaiting a response", () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);
    client.notify("ping", { now: true });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.payload.id).toBeNull();
  });

  it("fails in-flight requests and stops sending after close", async () => {
    const transport = new FakeTransport();
    const client = new JsonRpcClient(transport);
    const promise = client.request("a");
    client.close();

    expect(transport.listeners.size).toBe(0);
    await expect(promise).rejects.toThrow(/closed/);
    expect(() => client.notify("ping")).not.toThrow();
  });
});
