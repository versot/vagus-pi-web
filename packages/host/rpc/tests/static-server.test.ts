import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createStaticHandler, resolveStaticFile } from "../src/static-server.js";

/**
 * The daemon serves the built GUI over HTTP on the same port as the
 * WebSocket endpoint (M4). These tests pin the static server contract:
 * correct MIME types, SPA fallback, and — critically — path-traversal
 * protection, since the root is user-controlled in production.
 */

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "vagus-static-"));
  writeFileSync(join(root, "index.html"), "<html><body>app</body></html>");
  writeFileSync(join(root, "app.js"), "console.log('hi');");
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "index.html"), "<html>nested</html>");
  return root;
}

describe("resolveStaticFile", () => {
  const root = fixtureRoot();

  it("maps / to index.html", () => {
    expect(resolveStaticFile(root, "/")).toBe(join(root, "index.html"));
  });

  it("resolves real files", () => {
    expect(resolveStaticFile(root, "/app.js")).toBe(join(root, "app.js"));
  });

  it("falls back to index.html for extensionless routes (SPA)", () => {
    expect(resolveStaticFile(root, "/sessions/abc")).toBe(join(root, "index.html"));
  });

  it("resolves directories to their index.html", () => {
    expect(resolveStaticFile(root, "/nested")).toBe(join(root, "nested", "index.html"));
  });

  it("returns undefined for missing assets", () => {
    expect(resolveStaticFile(root, "/missing.js")).toBeUndefined();
  });

  it("blocks path traversal above the root", () => {
    expect(resolveStaticFile(root, "/../../etc/passwd")).toBeUndefined();
    expect(resolveStaticFile(root, "/..%2f..%2fetc%2fpasswd")).toBeUndefined();
    expect(resolveStaticFile(root, "/nested/../../../etc/passwd")).toBeUndefined();
  });
});

describe("createStaticHandler", () => {
  const root = fixtureRoot();
  const handler = createStaticHandler(root);

  function get(path: string): Promise<{ status: number; body: string; type: string }> {
    return new Promise((resolve, reject) => {
      const req = new Request(`http://vagus.local${path}`, { method: "GET" }) as unknown as Parameters<typeof handler>[0];
      const chunks: Buffer[] = [];
      // A real Writable so createReadStream().pipe() behaves like production.
      const res = new Writable({
        write(chunk: Buffer, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }) as unknown as Parameters<typeof handler>[1];
      let statusCode = 0;
      let headers: Record<string, string | number> = {};
      (res as unknown as { writeHead: (s: number, h: Record<string, string | number>) => void }).writeHead = (s, h) => {
        statusCode = s;
        headers = h;
      };
      try {
        handler(req, res);
        (res as unknown as { on: (e: string, cb: () => void) => void }).on("finish", () => {
          resolve({
            status: statusCode,
            body: Buffer.concat(chunks).toString(),
            type: String(headers["Content-Type"] ?? ""),
          });
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  it("serves index.html for /", async () => {
    const { status, body, type } = await get("/");
    expect(status).toBe(200);
    expect(body).toContain("<html>");
    expect(type).toContain("text/html");
  });

  it("serves JS assets with the javascript MIME type", async () => {
    const { status, type, body } = await get("/app.js");
    expect(status).toBe(200);
    expect(type).toContain("text/javascript");
    expect(body).toContain("console.log");
  });

  it("serves the SPA fallback for extensionless routes", async () => {
    const { status, body } = await get("/some/client/route");
    expect(status).toBe(200);
    expect(body).toContain("<html>");
  });

  it("returns 404 for missing assets", async () => {
    const { status } = await get("/nope.js");
    expect(status).toBe(404);
  });

  it("normalizes dot segments at parse time (stays in-app)", async () => {
    const { status, body } = await get("/../secrets");
    // URL normalization collapses `..` before routing — the request stays
    // inside the app shell instead of escaping the document root.
    expect(status).toBe(200);
    expect(body).toContain("<html>");
  });

  it("blocks encoded traversal attempts with 404", async () => {
    // %2f-encoded slashes survive URL normalization and decode to `../../` —
    // the resolveStaticFile root guard must reject them.
    const { status } = await get("/..%2f..%2fetc%2fpasswd");
    expect(status).toBe(404);
  });
});
