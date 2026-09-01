import { z } from "zod";

// ── Session History ──────────────────────────────────────────────────

/** Wire format for a session history entry (session.history / session.list). */
export const sessionHistoryItemSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string().optional(),
  cwd: z.string(),
  /** ISO timestamp (JSON-RPC serialises Date → ISO string). */
  created: z.string(),
  /** ISO timestamp (JSON-RPC serialises Date → ISO string). */
  modified: z.string(),
  messageCount: z.number(),
  firstMessage: z.string(),
});
export type SessionHistoryItem = z.infer<typeof sessionHistoryItemSchema>;

// ── Session Message (session.messages / session.open) ─────────────────

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.string(),
  result: z.string().optional(),
  isError: z.boolean().optional(),
  /** File-edit diff (pi display format) — persisted from live tool results. */
  diff: z.string().optional(),
  /** Unified patch — reverse-appliable to revert the edit. */
  patch: z.string().optional(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const sessionMessageSchema = z.object({
  role: z.string(),
  /** Plain text (user question / assistant answer body). */
  text: z.string(),
  /** Image attachments (user messages) — data URLs ready for <img src>. */
  images: z.array(z.object({ dataUrl: z.string(), mimeType: z.string() })).optional(),
  /** Assistant's reasoning, if the message had a thinking block. */
  thinking: z.string().optional(),
  /** Tool calls declared in an assistant message, matched with results. */
  toolCalls: z.array(toolCallSchema).optional(),
  /**
   * Total duration (ms) of this message's turn — user question → final
   * conclusion — carried by the turn's last message.
   */
  turnDurationMs: z.number().optional(),
});
export type SessionMessage = z.infer<typeof sessionMessageSchema>;

/** The daemon's session.open response: resumed session + its message path. */
export const sessionOpenResultSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  sessionFile: z.string().optional(),
  messages: z.array(sessionMessageSchema),
  /** Total visible messages in the session (for lazy-load pagination). */
  total: z.number().optional(),
  /** Index of the first returned message within the full history. */
  startIndex: z.number().optional(),
  /** True when older messages exist before this page (scroll-up loads more). */
  hasMore: z.boolean().optional(),
});
export type SessionOpenResult = z.infer<typeof sessionOpenResultSchema>;

/** A lazy-loaded page of earlier history (session.page). */
export const sessionPageResultSchema = z.object({
  messages: z.array(sessionMessageSchema),
  total: z.number(),
  startIndex: z.number(),
  hasMore: z.boolean(),
});
export type SessionPageResult = z.infer<typeof sessionPageResultSchema>;

// ── Usage Stats (usage.stats) ────────────────────────────────────────

export const usageStatModelSchema = z.object({
  model: z.string(),
  tokens: z.number(),
  cost: z.number(),
});
export type UsageStatModel = z.infer<typeof usageStatModelSchema>;

export const usageDailyPointSchema = z.object({
  /** Day start in ms. */
  ts: z.number(),
  tokens: z.number(),
  /** USD cost for that day (0 when the provider doesn't report cost). */
  cost: z.number(),
  messages: z.number(),
  sessions: z.number(),
  byModel: z.record(z.string(), z.number()),
});
export type UsageDailyPoint = z.infer<typeof usageDailyPointSchema>;

export const usageStatsSchema = z.object({
  totalTokens: z.number(),
  totalCost: z.number(),
  sessionCount: z.number(),
  messageCount: z.number(),
  peakTokens: z.number(),
  maxDurationMs: z.number(),
  firstTs: z.number(),
  lastTs: z.number(),
  currentStreak: z.number(),
  longestStreak: z.number(),
  activeDays: z.number(),
  perModel: z.array(usageStatModelSchema),
  daily: z.array(usageDailyPointSchema),
});
export type UsageStats = z.infer<typeof usageStatsSchema>;

// ── Model / Provider Config (models.config / models.save) ────────────

export const apiTypeSchema = z.enum([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);
export type ApiType = z.infer<typeof apiTypeSchema>;

/** OpenAI-compat quirks shared by provider and model entries. */
export const compatConfigSchema = z.object({
  supportsDeveloperRole: z.boolean().optional(),
  supportsReasoningEffort: z.boolean().optional(),
  /** How pi should parse the model's reasoning output (e.g. "deepseek"). */
  thinkingFormat: z.string().optional(),
  /** Assistant messages carry the reasoning field (deepseek-style). */
  requiresReasoningContentOnAssistantMessages: z.boolean().optional(),
});
export type CompatConfig = z.infer<typeof compatConfigSchema>;

/** A model entry in models.json (subset of pi's schema, GUI-editable fields). */
export const modelConfigSchema = z.object({
  id: z.string(),
  /** Human-readable label (optional; defaults to id). */
  name: z.string().optional(),
  /** API type override (defaults to provider's). */
  api: apiTypeSchema.optional(),
  /** Supports extended thinking. */
  reasoning: z.boolean().optional(),
  /** Input types: ["text"] or ["text", "image"]. */
  input: z.array(z.string()).optional(),
  /** Context window size in tokens. */
  contextWindow: z.number().optional(),
  /** Max output tokens. */
  maxTokens: z.number().optional(),
  /** Cost per million tokens. */
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional(),
    })
    .optional(),
  /** OpenAI-compat quirks (probe-filled, e.g. deepseek thinking format). */
  compat: compatConfigSchema.optional(),
});
export type ModelConfig = z.infer<typeof modelConfigSchema>;

/** A provider entry in models.json (wire format — models.config / models.save). */
export const providerConfigSchema = z.object({
  /** Provider id, e.g. "shinyway", "openai", "ollama". */
  id: z.string(),
  /** Whether the provider is enabled in the UI (undefined = enabled). */
  enabled: z.boolean().optional(),
  baseUrl: z.string(),
  api: apiTypeSchema,
  /** API key literal, `$ENV_VAR`, or `!command`. */
  apiKey: z.string().optional(),
  /** Custom headers. */
  headers: z.record(z.string(), z.string()).optional(),
  /** OpenAI-compat quirks (provider-level defaults). */
  compat: compatConfigSchema.optional(),
  models: z.array(modelConfigSchema),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;