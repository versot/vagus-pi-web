import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnDaemon } from "../daemon.js";

/**
 * `pi-web web` — spawns the daemon (which serves the built web UI over HTTP
 * on the same port as the WebSocket event stream) and opens the browser.
 *
 * One process, one port: the daemon serves `http://127.0.0.1:19707/` and
 * accepts `ws://127.0.0.1:19707` upgrades on the same HTTP server, so the
 * GUI attaches to the event stream with zero extra infrastructure.
 *
 * `gui` is kept as a backwards-compatible alias for `web`.
 */

const DEFAULT_WS_PORT = 19707;

/**
 * Resolves the built web UI directory.
 *
 * Resolution order:
 * 1. Published CLI package: `dist/gui/` (web assets copied at build time)
 * 2. Monorepo dev: `apps/gui/dist/` (built via `pnpm --filter @vagus/gui build`)
 */
function guiDistPath(): string | undefined {
  // Prod (published package): GUI assets ship inside the CLI package.
  const prod = fileURLToPath(new URL("../gui", import.meta.url));
  if (existsSync(join(prod, "index.html"))) return prod;
  // Dev (monorepo): apps/gui/dist, built via `pnpm --filter @vagus/pi-web-gui build`.
  const dev = fileURLToPath(new URL("../../../gui/dist", import.meta.url));
  if (existsSync(join(dev, "index.html"))) return dev;
  return undefined;
}

/** Opens the default browser to a URL, without blocking the CLI. */
function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
  } else if (platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  } else {
    spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

export async function runWeb(): Promise<number> {
  const dist = guiDistPath();
  if (!dist) {
    process.stderr.write(
      "pi-web: web UI build not found — run `pnpm --filter @vagus/pi-web-gui build` first.\n",
    );
    return 1;
  }

  const port = Number(process.env.VAGUS_WS_PORT ?? String(DEFAULT_WS_PORT));
  const url = `http://127.0.0.1:${port}/`;

  const child = spawnDaemon({
    stdio: ["ignore", "inherit", "pipe"],
    env: { VAGUS_GUI_DIR: dist },
  });

  let opened = false;
  let stderrBuf = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderrBuf += text;
    process.stderr.write(text);
    if (!opened && stderrBuf.includes("pi-web daemon ready")) {
      opened = true;
      process.stdout.write(`pi-web: web UI at ${url}\n`);
      openBrowser(url);
    }
  });

  child.on("exit", (code, signal) => {
    if (!opened && code !== 0) {
      process.stderr.write(`pi-web: daemon exited (code ${code ?? "?"}, signal ${signal ?? "none"}) before the UI was ready.\n`);
    } else {
      process.stderr.write(`pi-web: daemon exited (code ${code ?? "?"}, signal ${signal ?? "none"}).\n`);
    }
    process.exit(code ?? 0);
  });

  const shutdown = (): void => {
    child.kill();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  // Runs until the daemon exits (Ctrl+C kills the child via the handlers above).
  return new Promise<number>(() => {});
}
