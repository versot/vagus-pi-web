import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Daemon configuration store.
 *
 * A small JSON file (`<stateDir>/config.json`) holding runtime-tunable
 * settings for the daemon. Generic key/value — the daemon reads it live, so
 * changes take effect without a restart.
 *
 * Settings are deliberately few and operational; UI preferences (theme…)
 * stay in the client (localStorage), since multiple clients may connect.
 */

export interface VagusConfig {
  [key: string]: unknown;
}

const DEFAULT_CONFIG: VagusConfig = {};

export class ConfigStore {
  private readonly file: string;
  private readonly defaults: VagusConfig;

  constructor(options: { dir: string; defaults?: VagusConfig }) {
    this.file = join(options.dir, "config.json");
    this.defaults = options.defaults ?? DEFAULT_CONFIG;
  }

  /** Loads the current config, merging defaults (missing file → defaults). */
  read(): VagusConfig {
    try {
      const raw = readFileSync(this.file, "utf8") as string;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return { ...this.defaults, ...parsed };
    } catch {
      return { ...this.defaults };
    }
  }

  /** Persists a partial update, returning the merged result. */
  update(patch: Record<string, unknown>): VagusConfig {
    const next = { ...this.read(), ...patch };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }
}
