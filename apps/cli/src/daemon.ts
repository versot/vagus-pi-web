import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Shared daemon lifecycle for the CLI GUI frontend.
 *
 * `pi-web web` spawns `pi-web daemon` as a child process and attaches to its
 * protocol — the daemon is the single source of truth, the frontend is a pure
 * view. This module owns the entry-point resolution (source via tsx in dev,
 * built dist in production).
 */

/**
 * Detects the OS-level system proxy (Windows registry / macOS scutil), the
 * same source VS Code reads. Plain Node fetch ignores system proxy settings,
 * so we inject them as HTTPS_PROXY/HTTP_PROXY env vars into the daemon child
 * (with NODE_USE_ENV_PROXY=1, Node 24's built-in fetch proxy support) —
 * making the daemon follow the system proxy exactly like VS Code does.
 * Returns undefined when no system proxy is configured.
 */
function detectSystemProxy(): string | undefined {
  try {
    if (process.platform === "win32") {
      const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
      const out = execSync(`reg query "${key}" /v ProxyEnable`, { encoding: "utf8", timeout: 2000 });
      if (!/0x1/.test(out)) return undefined; // system proxy disabled
      const srv = execSync(`reg query "${key}" /v ProxyServer`, { encoding: "utf8", timeout: 2000 });
      const m = srv.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
      if (!m?.[1]) return undefined;
      // Formats: "host:port" or "http=...;https=host:port;ftp=..."
      let addr: string | undefined;
      if (m[1].includes("=")) {
        const https = m[1].split(";").find((p) => p.startsWith("https="));
        addr = (https ?? m[1].split(";")[0])?.split("=")[1] || undefined;
      } else {
        addr = m[1];
      }
      // EnvHttpProxyAgent requires a scheme — registry stores bare host:port.
      return addr && /^https?:\/\//.test(addr) ? addr : addr ? `http://${addr}` : undefined;
    }
    if (process.platform === "darwin") {
      const out = execSync("scutil --proxy", { encoding: "utf8", timeout: 2000 });
      const enabled = /HTTPSEnable\s*:\s*1/.test(out);
      const host = out.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1];
      const port = out.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
      return enabled && host && port ? `http://${host}:${port}` : undefined;
    }
  } catch {
    // registry/scutil unavailable — no system proxy
  }
  return undefined;
}

/** Daemon entry that works both from source (tsx) and built dist. */
function daemonEntryPath(): string {
  const base = fileURLToPath(new URL("./bin", import.meta.url));
  const source = `${base}.ts`;
  return existsSync(source) ? source : `${base}.js`;
}

export interface SpawnDaemonOptions {
  /** Extra environment variables merged over `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Stdio config for the child (defaults to piped; the TUI needs the stdio channel). */
  stdio?: Array<"pipe" | "ignore" | "inherit">;
}

/** Spawns the daemon child process. */
export function spawnDaemon(options: SpawnDaemonOptions = {}): ChildProcess {
  const entry = daemonEntryPath();
  // Dev (repo): the entry is a .ts source — run it through tsx. Prod (npx
  // bundle): the entry is the esbuild bundle — plain node, no tsx dependency.
  const args = entry.endsWith(".ts")
    ? ["--import", "tsx", entry, "daemon"]
    : [entry, "daemon"];
  // Follow the system proxy like VS Code does — unless the user already set
  // an explicit proxy env var (manual config wins).
  const injected: NodeJS.ProcessEnv = {};
  // Node 24+ built-in fetch only honors proxy env vars when explicitly
  // enabled — always set it; harmless when no proxy vars exist.
  injected.NODE_USE_ENV_PROXY = "1";
  if (!process.env.HTTPS_PROXY && !process.env.HTTP_PROXY) {
    const sysProxy = detectSystemProxy();
    if (sysProxy) {
      injected.HTTPS_PROXY = sysProxy;
      injected.HTTP_PROXY = sysProxy;
      injected.NO_PROXY = process.env.NO_PROXY ?? "localhost,127.0.0.1";
      process.stderr.write(`vagus: following system proxy → ${sysProxy}\n`);
    } else {
      process.stderr.write(`vagus: no system proxy detected (direct connections)\n`);
    }
  } else if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    process.stderr.write(`vagus: proxy env already set (HTTPS_PROXY=${process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY})\n`);
  }
  return spawn(process.execPath, args, {
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...injected, ...options.env },
  });
}
