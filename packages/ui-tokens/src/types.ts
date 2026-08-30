import type {
  SessionHistoryItem,
  SessionMessage,
  SessionOpenResult,
  SessionPageResult,
  UsageStatModel,
  UsageStats,
  UsageDailyPoint,
} from "@vagus/protocol";

/**
 * Shared types used across the GUI.
 *
 * Wire shapes live in @vagus/protocol (the single source of truth — host and
 * client both infer from the zod schemas). This file only re-exports those
 * and defines the UI-edit shape (ProviderConfigUI), which is intentionally
 * looser than the wire `api: ApiType` union because the settings form edits
 * api as a free string before validating.
 */

export type { SessionHistoryItem, SessionMessage, SessionOpenResult, SessionPageResult } from "@vagus/protocol";
export type { SessionHistoryItem as HistoryItem } from "@vagus/protocol";
/** A history message (from daemon session.open / session.messages). */
export type HistoryMessage = SessionMessage;
export type { UsageStats, UsageStatModel, UsageDailyPoint } from "@vagus/protocol";
/** Back-compat aliases for the usage UI types (same shape as protocol). */
export type UsageStatsUI = UsageStats;
export type UsageStatModelUI = UsageStatModel;
export type UsageDailyPointUI = UsageDailyPoint;

/**
 * A provider config as edited in the settings UI (models.json shape).
 * Intentionally `api: string` (not the wire ApiType union) — the form edits
 * it as free text; validation happens on save/probe.
 */
export interface ProviderConfigUI {
  id: string;
  /** Whether the provider is enabled in the UI (undefined = enabled). */
  enabled?: boolean;
  baseUrl: string;
  api: string;
  apiKey?: string;
  compat?: {
    supportsDeveloperRole?: boolean;
    supportsReasoningEffort?: boolean;
    thinkingFormat?: string;
    requiresReasoningContentOnAssistantMessages?: boolean;
  };
  models: Array<{
    id: string;
    name?: string;
    api?: string;
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  }>;
}
