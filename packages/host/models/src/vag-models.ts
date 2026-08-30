import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ApiType, CompatConfig, ModelConfig, ProviderConfig } from "@vagus/protocol";

/**
 * Vagus models.json configuration (M5 parity).
 *
 * Vagus model store — format compatible with pi's models.json so the
 * format compatible with pi's models.json (docs/models.md).
 * Schema mirrors pi's provider/model format.
 * writes is immediately usable by pi — no translation layer, no drift.
 *
 * The daemon owns file access (host side); the GUI talks to it over RPC.
 */

export interface ModelsFile {
  providers: Record<string, ProviderConfig>;
}

/** Normalizes a compat object read from disk (provider- or model-level). */
function normalizeCompat(raw: Record<string, unknown> | undefined): CompatConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: CompatConfig = {};
  if (typeof (raw as { supportsDeveloperRole?: unknown }).supportsDeveloperRole === "boolean") {
    out.supportsDeveloperRole = (raw as { supportsDeveloperRole?: boolean }).supportsDeveloperRole;
  }
  if (typeof (raw as { supportsReasoningEffort?: unknown }).supportsReasoningEffort === "boolean") {
    out.supportsReasoningEffort = (raw as { supportsReasoningEffort?: boolean }).supportsReasoningEffort;
  }
  if (typeof (raw as { thinkingFormat?: unknown }).thinkingFormat === "string") {
    out.thinkingFormat = (raw as { thinkingFormat?: string }).thinkingFormat;
  }
  if (typeof (raw as { requiresReasoningContentOnAssistantMessages?: unknown }).requiresReasoningContentOnAssistantMessages === "boolean") {
    out.requiresReasoningContentOnAssistantMessages = (raw as { requiresReasoningContentOnAssistantMessages?: boolean }).requiresReasoningContentOnAssistantMessages;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Normalizes a provider object read from disk into a typed shape. */
function normalizeProvider(id: string, raw: Record<string, unknown>): ProviderConfig {
  const models = Array.isArray(raw.models)
    ? (raw.models as Record<string, unknown>[]).map((m) => ({
        id: String(m.id ?? ""),
        name: typeof m.name === "string" ? m.name : undefined,
        api: typeof m.api === "string" ? (m.api as ApiType) : undefined,
        reasoning: m.reasoning === true ? true : undefined,
        input: Array.isArray(m.input) ? m.input.map(String) : undefined,
        contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
        maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : undefined,
        cost:
          m.cost && typeof m.cost === "object"
            ? {
                input: Number((m.cost as { input?: unknown }).input ?? 0),
                output: Number((m.cost as { output?: unknown }).output ?? 0),
                cacheRead: typeof (m.cost as { cacheRead?: unknown }).cacheRead === "number"
                  ? ((m.cost as { cacheRead?: unknown }).cacheRead as number)
                  : undefined,
                cacheWrite: typeof (m.cost as { cacheWrite?: unknown }).cacheWrite === "number"
                  ? ((m.cost as { cacheWrite?: unknown }).cacheWrite as number)
                  : undefined,
              }
            : undefined,
        compat: normalizeCompat((m as { compat?: unknown }).compat as Record<string, unknown> | undefined),
      }))
    : [];
  return {
    id,
    enabled: raw.enabled === false ? false : undefined,
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
    api: typeof raw.api === "string" ? (raw.api as ApiType) : "openai-completions",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : undefined,
    headers: typeof raw.headers === "object" && raw.headers !== null ? (raw.headers as Record<string, string>) : undefined,
    compat: normalizeCompat(raw.compat as Record<string, unknown> | undefined),
    models,
  };
}

/** Serializes a compat object (provider- or model-level). */
function serializeCompat(compat: CompatConfig): Record<string, unknown> {
  return {
    ...(compat.supportsDeveloperRole !== undefined
      ? { supportsDeveloperRole: compat.supportsDeveloperRole }
      : {}),
    ...(compat.supportsReasoningEffort !== undefined
      ? { supportsReasoningEffort: compat.supportsReasoningEffort }
      : {}),
    ...(compat.thinkingFormat !== undefined
      ? { thinkingFormat: compat.thinkingFormat }
      : {}),
    ...(compat.requiresReasoningContentOnAssistantMessages !== undefined
      ? { requiresReasoningContentOnAssistantMessages: compat.requiresReasoningContentOnAssistantMessages }
      : {}),
  };
}

/** Serializes a provider back to the pi models.json shape. */
export function serializeProvider(provider: ProviderConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    baseUrl: provider.baseUrl,
    api: provider.api,
  };
  if (provider.enabled !== undefined) out.enabled = provider.enabled;
  if (provider.apiKey) out.apiKey = provider.apiKey;
  if (provider.headers && Object.keys(provider.headers).length > 0) out.headers = provider.headers;
  if (provider.compat && Object.keys(provider.compat).length > 0) {
    out.compat = serializeCompat(provider.compat);
  }
  out.models = provider.models.map((m) => {
    const model: Record<string, unknown> = { id: m.id };
    if (m.name) model.name = m.name;
    if (m.api) model.api = m.api;
    if (m.reasoning) model.reasoning = true;
    if (m.input) model.input = m.input;
    if (m.contextWindow !== undefined) model.contextWindow = m.contextWindow;
    if (m.maxTokens !== undefined) model.maxTokens = m.maxTokens;
    if (m.cost) {
      model.cost = {
        input: m.cost.input,
        output: m.cost.output,
        ...(m.cost.cacheRead !== undefined ? { cacheRead: m.cost.cacheRead } : {}),
        ...(m.cost.cacheWrite !== undefined ? { cacheWrite: m.cost.cacheWrite } : {}),
      };
    }
    if (m.compat && Object.keys(m.compat).length > 0) {
      model.compat = serializeCompat(m.compat);
    }
    return model;
  });
  return out;
}

/**
 * Reads/writes models.json from the engine dir. Defaults to `~/.vagus`;
 * agent dir; tests inject a temp dir.
 */
export class VagModelsStore {
  constructor(private readonly engineDir: string) {}

  private get file(): string {
    return join(this.engineDir, "models.json");
  }

  /** Loads providers (missing file → empty). */
  read(): ProviderConfig[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { providers?: Record<string, unknown> };
      if (!raw.providers || typeof raw.providers !== "object") return [];
      return Object.entries(raw.providers).map(([id, p]) => normalizeProvider(id, p as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  /** Backs up models.json to models.json.bak. Called after every save. */
  backup(): void {
    if (existsSync(this.file)) {
      copyFileSync(this.file, this.bakFile);
    }
  }

  /** Restores models.json from the backup (if it exists). */
  restoreFromBackup(): boolean {
    if (!existsSync(this.bakFile)) return false;
    copyFileSync(this.bakFile, this.file);
    return true;
  }

  private get bakFile(): string {
    return `${this.file}.bak`;
  }

  /** Writes providers back as models.json (preserving unknown fields). */
  write(providers: ProviderConfig[]): void {
    // Merge with existing raw file so pi-specific fields the GUI doesn't
    // model (modelOverrides, oauth, samplingParams…) survive a save.
    const existing = this.readRaw();
    const merged: Record<string, unknown> = { ...existing };
    const providersOut: Record<string, unknown> = {};
    for (const provider of providers) {
      const rawExisting = (existing.providers?.[provider.id] ?? {}) as Record<string, unknown>;
      providersOut[provider.id] = { ...rawExisting, ...serializeProvider(provider) };
    }
    merged.providers = providersOut;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  }

  private readRaw(): { providers?: Record<string, unknown> } {
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as { providers?: Record<string, unknown> };
    } catch {
      return {};
    }
  }
}
