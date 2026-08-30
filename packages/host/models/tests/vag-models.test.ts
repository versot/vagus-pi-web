import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VagModelsStore, serializeProvider } from "../src/vag-models.js";

describe("VagModelsStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vagus-models-"));
  });
  afterEach(() => {});

  it("returns empty providers for a missing file", () => {
    const store = new VagModelsStore(dir);
    expect(store.read()).toEqual([]);
  });

  it("normalizes a real pi models.json shape", () => {
    const file = join(dir, "models.json");
    writeFileSync(
      file,
      JSON.stringify({
        providers: {
          shinyway: {
            baseUrl: "https://new-api.shinyway.com/v1",
            api: "openai-completions",
            apiKey: "sk-test",
            compat: { supportsDeveloperRole: false },
            models: [
              {
                id: "deepseek-v4-flash",
                name: "DeepSeek V4 Flash",
                contextWindow: 1000000,
                maxTokens: 384000,
                input: ["text"],
                reasoning: true,
                cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 },
              },
            ],
          },
        },
      }),
      "utf8",
    );

    const store = new VagModelsStore(dir);
    const providers = store.read();
    expect(providers).toHaveLength(1);
    const p = providers[0]!;
    expect(p.id).toBe("shinyway");
    expect(p.baseUrl).toBe("https://new-api.shinyway.com/v1");
    expect(p.api).toBe("openai-completions");
    expect(p.apiKey).toBe("sk-test");
    expect(p.models).toHaveLength(1);
    expect(p.models[0]).toMatchObject({
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      contextWindow: 1000000,
      reasoning: true,
      cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 },
    });
  });

  it("round-trips a provider edit without losing unknown fields", () => {
    const file = join(dir, "models.json");
    writeFileSync(
      file,
      JSON.stringify({
        providers: {
          shinyway: {
            baseUrl: "https://old/v1",
            api: "openai-completions",
            apiKey: "sk-1",
            // Field pi reads but the GUI doesn't model — must survive a save.
            modelOverrides: { "gpt-4o": { contextWindow: 200000 } },
            models: [{ id: "deepseek-v4-flash" }],
          },
        },
      }),
      "utf8",
    );

    const store = new VagModelsStore(dir);
    const providers = store.read();
    providers[0]!.baseUrl = "https://new/v1";
    providers[0]!.models.push({ id: "gpt-4o", name: "GPT-4o" });
    store.write(providers);

    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      providers: Record<string, Record<string, unknown>>;
    };
    // Unknown field survived
    expect(raw.providers["shinyway"]?.["modelOverrides"]).toEqual({ "gpt-4o": { contextWindow: 200000 } });
    // Edited field persisted
    expect(raw.providers["shinyway"]?.baseUrl).toBe("https://new/v1");
    // New model added
    expect(raw.providers["shinyway"]?.models).toEqual([
      { id: "deepseek-v4-flash" },
      { id: "gpt-4o", name: "GPT-4o" },
    ]);
  });

  it("serializeProvider drops empty optional fields", () => {
    const out = serializeProvider({
      id: "p",
      baseUrl: "https://x/v1",
      api: "openai-completions",
      models: [{ id: "m1" }],
    });
    expect(out).toEqual({ baseUrl: "https://x/v1", api: "openai-completions", models: [{ id: "m1" }] });
    expect(out.apiKey).toBeUndefined();
    expect(out.compat).toBeUndefined();
  });
});
