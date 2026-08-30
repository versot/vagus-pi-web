import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * Pi package manager for the web GUI.
 *
 * Plugin/extension installs go through pi's OWN PackageManager (SDK), which
 * persists to `~/.pi/agent/settings.json` under `packages` — the exact same
 * file and format `pi install npm:@foo/bar` writes. So installing a package
 * from the web GUI is indistinguishable from installing it in the pi TUI:
 * `pi list` sees it, `pi remove` can uninstall it, and vice versa.
 *
 * MCP server configuration (mcp.json) is a BUILT-IN feature here (not a
 * plugin): the management layer lives in this class, and the connection
 * layer is the bundled MCP pi-extension that ships with this package.
 */

export interface PiPackageInfo {
  /** Normalized source spec, e.g. "npm:@foo/bar@1.0.0" or "git:host/repo@v1". */
  source: string;
  /** Which settings scope the package is configured in. */
  scope: "user" | "project";
  /** Whether the package is currently installed on disk. */
  installed: boolean;
  /** On-disk install path (npm → ~/.pi/agent/npm/..., git → ~/.pi/agent/git/...). */
  installedPath?: string;
  /** Resource counts the package contributes (resolved from its manifest). */
  resources: { extensions: number; skills: number; prompts: number; themes: number };
}

export interface MarketEntry {
  source: string;
  name: string;
  description?: string;
  installed: boolean;
}

export interface McpServerEntry {
  name: string;
  config: Record<string, unknown>;
}

export type McpScope = "user" | "project";

/** Directory under which pi manages installed packages (npm clones / git clones). */
const MANAGED_DIRS = ["npm", "git"] as const;

export class PiPackageManager {
  private readonly engineDir: string;
  private readonly cwd: string;
  private pm: DefaultPackageManager | undefined;

  constructor(opts: { engineDir: string; cwd?: string }) {
    this.engineDir = opts.engineDir;
    this.cwd = opts.cwd ?? process.cwd();
  }

  /** Lazily create pi's package manager (SettingsManager is cheap to build). */
  private manager(): DefaultPackageManager {
    if (!this.pm) {
      const settingsManager = SettingsManager.create(this.cwd, this.engineDir);
      this.pm = new DefaultPackageManager({
        cwd: this.cwd,
        agentDir: this.engineDir,
        settingsManager,
      });
    }
    return this.pm;
  }

  // ── packages (pi install npm:... / git:... — TUI-identical) ─────────

  /**
   * List configured packages. `source` strings are exactly what the pi CLI
   * shows in `pi list`, so the web GUI and the TUI stay in sync.
   */
  async list(): Promise<PiPackageInfo[]> {
    const configured = this.manager().listConfiguredPackages();
    // Resolve once so each package reports its enabled resource counts.
    // Resolution is best-effort: listing never auto-installs missing sources
    // (the onMissing callback returns "skip" for anything not installed).
    let resolved: Awaited<ReturnType<DefaultPackageManager["resolve"]>> | undefined;
    try {
      resolved = await this.manager().resolve(async () => "skip");
    } catch {
      resolved = undefined;
    }

    return configured.map((pkg) => {
      const installedPath = pkg.installedPath ?? this.manager().getInstalledPath(pkg.source, pkg.scope);
      const resources = this.countResources(pkg.source, resolved);
      return {
        source: pkg.source,
        scope: pkg.scope,
        installed: installedPath !== undefined,
        installedPath,
        resources,
      };
    });
  }

  /** Count enabled resources contributed by one package source. */
  private countResources(
    source: string,
    resolved: Awaited<ReturnType<DefaultPackageManager["resolve"]>> | undefined,
  ): { extensions: number; skills: number; prompts: number; themes: number } {
    const none = { extensions: 0, skills: 0, prompts: 0, themes: 0 };
    if (!resolved) return none;
    const from = (list: Array<{ metadata: { source: string } }>): number =>
      list.filter((r) => r.metadata.source === source).length;
    return {
      extensions: from(resolved.extensions),
      skills: from(resolved.skills),
      prompts: from(resolved.prompts),
      themes: from(resolved.themes),
    };
  }

  /**
   * Install a pi package — equivalent to `pi install <source>`.
   *
   * Accepted sources (pi's format): `npm:@foo/bar@1.0.0`, `git:github.com/u/r@v1`,
   * `https://github.com/u/r`, or a local path. `-l` project-local installs are
   * not exposed from the web GUI (we always install at user scope, matching
   * the default `pi install` behavior).
   */
  async install(source: string): Promise<{ ok: boolean; error?: string }> {
    // Lenient: accept a full `pi install npm:xxx` command copied from docs —
    // strip the `pi install ` prefix so pasting works directly.
    const cleaned = source.trim().replace(/^pi\s+install\s+/i, "");
    const spec = cleaned.trim();
    if (spec === "") return { ok: false, error: "包源不能为空" };
    try {
      await this.manager().installAndPersist(spec);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Remove a pi package — equivalent to `pi remove <source>`.
   */
  async uninstall(source: string): Promise<{ ok: boolean; error?: string }> {
    const spec = source.trim();
    if (spec === "") return { ok: false, error: "包源不能为空" };
    try {
      const removed = await this.manager().removeAndPersist(spec);
      if (!removed) return { ok: false, error: "未找到该包（可能并未安装）" };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── MCP server config (mcp.json — built-in feature) ────────────────
  // Scope: "user" writes the engine dir's mcp.json (user-global, read by the
  // bundled MCP extension in every pi session); "project" writes
  // <cwd>/.mcp.json (project-local, also read by the extension).

  /** mcp.json path — the engine dir's mcp.json, read by the built-in MCP ext. */
  private get mcpJsonPath(): string {
    return join(this.engineDir, "mcp.json");
  }

  private mcpFilePath(scope: "user" | "project", cwd?: string): string {
    return scope === "project" ? join(cwd ?? ".", ".mcp.json") : this.mcpJsonPath;
  }

  private readMcpJsonFile(path: string): Record<string, unknown> {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      return typeof raw.mcpServers === "object" && raw.mcpServers !== null
        ? (raw.mcpServers as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private writeMcpJsonFile(path: string, servers: Record<string, unknown>): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ mcpServers: servers }, null, 2) + "\n", "utf8");
  }

  mcpList(scope: McpScope = "user", cwd?: string): McpServerEntry[] {
    const servers = this.readMcpJsonFile(this.mcpFilePath(scope, cwd));
    return Object.entries(servers).map(([name, config]) => ({
      name,
      config: typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {},
    }));
  }

  mcpAdd(opts: { name: string; config: Record<string, unknown>; scope?: McpScope; cwd?: string }): { ok: boolean; error?: string } {
    if (!opts.name.trim()) return { ok: false, error: "名称必填" };
    if (!opts.config || typeof opts.config !== "object") return { ok: false, error: "配置无效" };
    const scope = opts.scope ?? "user";
    const path = this.mcpFilePath(scope, opts.cwd);
    const servers = this.readMcpJsonFile(path);
    servers[opts.name] = opts.config;
    this.writeMcpJsonFile(path, servers);
    return { ok: true };
  }

  mcpUpdate(opts: { name: string; config: Record<string, unknown>; scope?: McpScope; cwd?: string }): { ok: boolean; error?: string } {
    if (!opts.name.trim()) return { ok: false, error: "名称必填" };
    if (!opts.config || typeof opts.config !== "object") return { ok: false, error: "配置无效" };
    const scope = opts.scope ?? "user";
    const path = this.mcpFilePath(scope, opts.cwd);
    const servers = this.readMcpJsonFile(path);
    if (!(opts.name in servers)) return { ok: false, error: "服务器不存在" };
    servers[opts.name] = opts.config;
    this.writeMcpJsonFile(path, servers);
    return { ok: true };
  }

  mcpRemove(name: string, scope: McpScope = "user", cwd?: string): { ok: boolean; error?: string } {
    const path = this.mcpFilePath(scope, cwd);
    const servers = this.readMcpJsonFile(path);
    if (!(name in servers)) return { ok: false, error: "服务器不存在" };
    delete servers[name];
    this.writeMcpJsonFile(path, servers);
    return { ok: true };
  }
}
