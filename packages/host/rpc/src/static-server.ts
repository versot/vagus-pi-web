import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

/**
 * Minimal static file server for the daemon's web UI (M4).
 *
 * The GUI is a plain Vite SPA build; the daemon serves it over HTTP on the
 * same port as the WebSocket endpoint (one process, one port — the browser
 * loads the UI from `http://127.0.0.1:19707/` and the UI attaches to
 * `ws://127.0.0.1:19707`).
 *
 * Zero dependencies and deliberately small: enough for a production SPA
 * (correct MIME types, path-traversal protection, SPA fallback, HEAD
 * support) without pulling in a framework.
 */

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function contentType(pathname: string): string {
  return MIME_TYPES[extname(pathname)] ?? "application/octet-stream";
}

/**
 * Resolves a request pathname to a file inside `root`, or `undefined` when
 * the request does not map to a file. Guards against path traversal
 * (`../` escaping the root) and implements the SPA fallback (extensionless
 * routes serve `index.html`).
 */
export function resolveStaticFile(rootDir: string, pathname: string): string | undefined {
  const root = resolve(rootDir);
  const name = pathname === "/" ? "index.html" : pathname;

  const candidate = resolve(join(root, name));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    // Escaped the document root — never serve.
    return undefined;
  }

  if (existsSync(candidate)) {
    if (statSync(candidate).isDirectory()) {
      const index = join(candidate, "index.html");
      return existsSync(index) ? index : undefined;
    }
    return candidate;
  }

  // SPA fallback: extensionless routes render the app shell so client-side
  // routing (future session pages) works without a server config.
  if (extname(name) === "") {
    const index = join(root, "index.html");
    return existsSync(index) ? index : undefined;
  }
  return undefined;
}

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body?: Buffer | string,
): void {
  res.writeHead(status, headers);
  if (body !== undefined) res.end(body);
  else res.end();
}

/** HTTP request handler serving a static directory (see {@link createStaticHandler}). */
export type StaticHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Creates a request handler that serves files from `rootDir`.
 *
 * - `GET`/`HEAD` only (405 otherwise)
 * - correct MIME types + `Content-Length` for streaming
 * - `Cache-Control: no-cache` so a redeployed UI is picked up immediately
 * - SPA fallback for extensionless routes
 */
export function createStaticHandler(rootDir: string): StaticHandler {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "method not allowed\n");
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://vagus.local").pathname;
      pathname = decodeURIComponent(pathname);
    } catch {
      send(res, 400, { "Content-Type": "text/plain; charset=utf-8" }, "bad request\n");
      return;
    }

    const file = resolveStaticFile(rootDir, pathname);
    if (!file) {
      send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "not found\n");
      return;
    }

    const stat = statSync(file);
    const headers: Record<string, string> = {
      "Content-Type": contentType(file),
      "Content-Length": String(stat.size),
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}
