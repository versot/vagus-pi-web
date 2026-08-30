import * as Diff from "diff";
import { isAbsolute, join } from "node:path";

/**
 * Pure display/serialization helpers shared across the engine. No class
 * state — every function derives its output purely from its inputs, so they
 * live here (out of VagusEngine) and are trivially unit-testable.
 */

/** Serializes tool arguments for display (JSON, truncated). */
export function serializeToolArg(args: unknown): string {
  try {
    const text = typeof args === "string" ? args : JSON.stringify(args, null, 2);
    return truncateDisplay(text);
  } catch {
    return String(args);
  }
}

/** Extracts display text from a tool result (content blocks or string). */
export function toolResultText(result: unknown): string {
  if (typeof result === "string") return truncateDisplay(result);
  const r = result as { content?: unknown; details?: unknown } | null | undefined;
  if (!r) return "";
  if (typeof r.content === "string") return truncateDisplay(r.content);
  if (Array.isArray(r.content)) {
    const parts: string[] = [];
    for (const block of r.content) {
      const b = block as { type?: unknown; text?: unknown };
      if (b && b.type === "text" && typeof b.text === "string") parts.push(b.text);
      else if (b && b.type === "image") parts.push("[image]");
    }
    return truncateDisplay(parts.join("\n"));
  }
  // Fallback: try JSON for opaque results (e.g. tool details only).
  try {
    return truncateDisplay(JSON.stringify(r, null, 2));
  } catch {
    return "";
  }
}

/** Caps display text so huge tool outputs don't flood the UI. */
export function truncateDisplay(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

/**
 * Extracts the file-edit diff for display. Prefers pi's unified patch
 * (`details.patch` — the format developers know: `@@` hunks, `a/`/`b/` headers)
 * and falls back to pi's display diff (`details.diff`, `+N`/`-N` rows).
 * Write tools and non-edit tools have neither.
 */
export function extractToolDiff(result: unknown): string | undefined {
  const r = result as { details?: { patch?: unknown; diff?: unknown } } | null | undefined;
  const patch = r?.details?.patch;
  if (typeof patch === "string" && patch.trim() !== "") return truncateDisplay(patch, 40_000);
  const diff = r?.details?.diff;
  if (typeof diff !== "string" || diff.trim() === "") return undefined;
  return truncateDisplay(diff, 20_000);
}

/**
 * Extracts the target file path from a tool's args, resolved against the
 * session cwd. Only path-carrying file tools (write/edit/multi_edit) return one;
 * shell and read-only tools return undefined.
 */
export function extractToolPath(args: unknown, cwd: string): string | undefined {
  const a = args as Record<string, unknown> | undefined;
  const raw = a?.path ?? a?.file_path;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const abs = isAbsolute(raw) ? raw : join(cwd, raw);
  // Normalise WSL-style /mnt/d/... to Windows D:/... — the daemon runs on
  // Windows, so every path (baselines, revert, diffs) must be one canonical
  // form or lookups/operations silently mismatch.
  return abs.replace(/^\/mnt\/([a-zA-Z])\//, (_m, d: string) => `${d.toUpperCase()}:/`);
}

/**
 * Computes a unified diff + patch from a tool's before/after file content
 * (used for tools that don't provide pi's details.diff, e.g. write). Both
 * `diff` (display) and `patch` are the unified format so the UI shows one
 * consistent style. The patch uses `a/` `b/` relative paths.
 */
export function computeToolDiff(path: string, oldContent: string, newContent: string, cwd: string): { diff?: string; patch?: string } {
  if (oldContent === newContent) return {};
  const rel = path.startsWith(cwd + "/") ? path.slice(cwd.length + 1) : path;
  const patch = Diff.createTwoFilesPatch(`a/${rel}`, `b/${rel}`, oldContent, newContent, undefined, undefined, {
    context: 4,
    headerOptions: Diff.FILE_HEADERS_ONLY,
  });
  const out = truncateDisplay(patch, 40_000);
  if (!out) return {};
  return { diff: out, patch: out };
}

/** Extracts the unified patch (pi's `details.patch`) — a standard git-style
 * diff for the edit. Falls back to undefined for tools without a patch. */
export function extractToolPatch(result: unknown): string | undefined {
  const r = result as { details?: { patch?: unknown } } | null | undefined;
  const patch = r?.details?.patch;
  if (typeof patch !== "string" || patch.trim() === "") return undefined;
  return truncateDisplay(patch, 40_000);
}

/**
 * Extracts display text from a pi session message. Uses a minimal structural
 * shape instead of pi's AgentMessage type (which is an SDK-internal union) —
 * content is either a plain string or a list of text/image content blocks.
 */
export interface SessionEntryLike {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: { role?: unknown; content?: unknown };
  summary?: unknown;
  modelId?: unknown;
  provider?: unknown;
  thinkingLevel?: unknown;
}

/** One-line preview of a session entry for the tree view. */
export function sessionEntryPreview(entry: SessionEntryLike): string | undefined {
  if (entry.type === "message" && entry.message) {
    const role = String(entry.message.role ?? "");
    const text = messageToText({ role, content: entry.message.content } as HistoryMessageLike).replace(/\s+/g, " ").trim();
    if (role === "user") return `❯ ${text}`;
    if (role === "assistant") return text.slice(0, 120);
    if (role === "toolResult") return `⚙ ${text.slice(0, 80)}`;
    return text.slice(0, 120);
  }
  if (entry.type === "model_change") return `◇ 模型切换 → ${String(entry.provider ?? "")}/${String(entry.modelId ?? "")}`;
  if (entry.type === "thinking_level_change") return `◈ 思考级别 → ${String(entry.thinkingLevel ?? "")}`;
  if (entry.type === "compaction" && typeof entry.summary === "string") return `◌ 压缩: ${entry.summary.slice(0, 100)}`;
  if (entry.type === "branch_summary" && typeof entry.summary === "string") return `◔ 分支摘要: ${entry.summary.slice(0, 100)}`;
  if (entry.type === "label") return `🏷 ${String(entry.id)}`;
  if (entry.type === "session_info") return `▪ 会话信息`;
  return `· ${entry.type}`;
}

export interface HistoryMessageLike {
  role: unknown;
  content?: unknown;
}

/** Parsed view of a message's content blocks. */
export interface ParsedBlocks {
  text: string;
  thinking?: string;
  images: Array<{ dataUrl: string; mimeType: string }>;
  toolCalls: Array<{ id: string; name: string; args: string }>;
}

/**
 * Splits a pi message into its display parts: plain text, thinking text, and
 * tool-call declarations (id/name/args). Content blocks that are none of
 * those (images, custom UI) are skipped.
 */
export function parseContentBlocks(message: HistoryMessageLike): ParsedBlocks {
  const content = message.content;
  const parsed: ParsedBlocks = { text: "", images: [], toolCalls: [] };
  if (typeof content === "string") {
    parsed.text = content;
    return parsed;
  }
  if (!Array.isArray(content)) return parsed;

  const textParts: string[] = [];
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown; thinking?: unknown; id?: unknown; name?: unknown; arguments?: unknown; data?: unknown; mimeType?: unknown };
    if (!b || typeof b.type !== "string") continue;
    if (b.type === "text" && typeof b.text === "string") {
      textParts.push(b.text);
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      parsed.thinking = b.thinking;
    } else if (b.type === "toolCall" && typeof b.name === "string") {
      parsed.toolCalls.push({
        id: typeof b.id === "string" ? b.id : "",
        name: b.name,
        args: serializeToolArg(b.arguments),
      });
    } else if (b.type === "image" && typeof b.data === "string") {
      // pi persists image blocks with a full data URL (data:image/png;base64,…)
      // in `data` and the mime type in `mimeType`. Pass the data URL straight
      // through so the UI can render it with <img src>. If the data is raw
      // base64 without the prefix, re-add it.
      const data = b.data.startsWith("data:") ? b.data : `data:${typeof b.mimeType === "string" && b.mimeType !== "" ? b.mimeType : "image/png"};base64,${b.data}`;
      parsed.images.push({
        dataUrl: data,
        mimeType: typeof b.mimeType === "string" ? b.mimeType : "image/png",
      });
    }
  }
  parsed.text = textParts.join("\n");
  return parsed;
}

export function messageToText(message: HistoryMessageLike): string {
  return parseContentBlocks(message).text;
}
