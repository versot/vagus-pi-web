import { spawn, type ChildProcess } from "node:child_process";
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
  return spawn(process.execPath, args, {
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
  });
}
