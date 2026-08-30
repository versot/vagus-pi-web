import type { ChatItem } from "./chat.js";

/**
 * Shared file-edit helpers for the diff summary panel and the right-pane
 * diff viewer. A "file edit" is a tool card that carried a diff (edit /
 * multi-edit tools attach pi's display diff + unified patch to the result).
 */

export interface FileEdit {
  /** Best-effort file path extracted from the tool args. */
  file: string;
  /** The tool-call id that produced this edit. */
  toolCallId: string;
  /** pi's display diff (`+`/`-`/space lines with line numbers). */
  diff?: string;
  /** Unified patch — reverse-appliable to revert the edit. */
  patch?: string;
  /** Added / removed line counts (from the display diff). */
  added: number;
  removed: number;
}

/** Extracts the file path from a serialized tool args blob (best-effort). */
export function fileFromArgs(args: string): string {
  let p: string | undefined;
  try {
    const parsed = JSON.parse(args) as { file_path?: unknown; path?: unknown };
    const hit = typeof parsed.file_path === "string" ? parsed.file_path : typeof parsed.path === "string" ? parsed.path : undefined;
    p = hit;
  } catch {
    /* truncated JSON — fall through to regex */
  }
  if (!p) {
    const m = args.match(/"file_path"\s*:\s*"([^"]+)"|"path"\s*:\s*"([^"]+)"/);
    p = m ? (m[1] ?? m[2]) : undefined;
  }
  return p ? normalizePath(p) : "未知文件";
}

/** Normalises a path: backslashes → slashes, WSL /mnt/d/ → Windows D:/. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/mnt\/([a-zA-Z])\//, (_m, d: string) => `${d.toUpperCase()}:/`);
}

/** Counts added/removed lines in pi's display diff (untruncated for +/- rows). */
export function countDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    const c = line[0];
    if (c === "+") added += 1;
    else if (c === "-") removed += 1;
  }
  return { added, removed };
}

/** Collects every file edit (tool card carrying a diff) in the item stream. */
export function collectEdits(items: ChatItem[]): FileEdit[] {
  const out: FileEdit[] = [];
  for (const item of items) {
    if (item.kind !== "tool" || !item.diff || !item.toolCallId) continue;
    out.push({
      file: fileFromArgs(item.args),
      toolCallId: item.toolCallId,
      diff: item.diff,
      patch: item.patch,
      ...countDiff(item.diff),
    });
  }
  return out;
}

/** Basename of a file path (for tabs / compact rows). */
export function baseName(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? file;
}
