import { describe, expect, it } from "vitest";
import { makeError, JsonRpcRequest, JsonRpcResponse } from "../src/jsonrpc.js";

describe("JsonRpcRequest", () => {
  it("accepts a minimal valid request", () => {
    const request = { jsonrpc: "2.0" as const, id: 1, method: "ping" };
    expect(JsonRpcRequest.safeParse(request).success).toBe(true);
  });

  it("accepts a notification (id null) with params", () => {
    const request = { jsonrpc: "2.0" as const, id: null, method: "notify", params: { a: 1 } };
    expect(JsonRpcRequest.safeParse(request).success).toBe(true);
  });

  it("rejects a non-2.0 jsonrpc version", () => {
    const request = { jsonrpc: "1.0" as const, id: 1, method: "ping" };
    expect(JsonRpcRequest.safeParse(request).success).toBe(false);
  });

  it("rejects an empty method", () => {
    const request = { jsonrpc: "2.0" as const, id: 1, method: "" };
    expect(JsonRpcRequest.safeParse(request).success).toBe(false);
  });
});

describe("JsonRpcResponse", () => {
  it("accepts a result response", () => {
    const response = { jsonrpc: "2.0" as const, id: 1, result: "ok" };
    expect(JsonRpcResponse.safeParse(response).success).toBe(true);
  });

  it("accepts an error response", () => {
    const response = { jsonrpc: "2.0" as const, id: 1, error: { code: -32601, message: "nope" } };
    expect(JsonRpcResponse.safeParse(response).success).toBe(true);
  });

  it("rejects a response with both result and error", () => {
    const response = {
      jsonrpc: "2.0" as const,
      id: 1,
      result: "ok",
      error: { code: -1, message: "nope" },
    };
    expect(JsonRpcResponse.safeParse(response).success).toBe(false);
  });

  it("rejects a response with neither result nor error", () => {
    const response = { jsonrpc: "2.0" as const, id: 1 };
    expect(JsonRpcResponse.safeParse(response).success).toBe(false);
  });

  it("makeError omits undefined data", () => {
    expect(makeError(-32600, "bad")).toEqual({ code: -32600, message: "bad" });
    expect(makeError(-32600, "bad", { hint: 1 })).toEqual({
      code: -32600,
      message: "bad",
      data: { hint: 1 },
    });
  });
});
