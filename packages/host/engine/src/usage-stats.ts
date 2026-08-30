import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { UsageDailyPoint, UsageStats, UsageStatModel } from "@vagus/protocol";

/**
 * Aggregates token/cost usage across all persisted sessions (pi JSONL).
 * Each assistant message carries a `usage` record (tokens + cost); this
 * sums them per session and per model. Used by the settings usage panel.
 *
 * Pure function — no engine state; reads pi's session store directly.
 */
export async function aggregateUsageStats(): Promise<UsageStats> {
  const infos = await SessionManager.listAll();
  let totalTokens = 0;
  let totalCost = 0;
  let messageCount = 0;
  let peakTokens = 0;
  let maxDurationMs = 0;
  let firstTs = 0;
  let lastTs = 0;
  const byModel = new Map<string, { tokens: number; cost: number }>();
  const activeDates = new Set<number>();
  const DAY = 86_400_000;
  const dayMap = new Map<number, { tokens: number; messages: number; sessions: number; byModel: Map<string, number> }>();
  const dayAt = (ts: number): number => Math.floor(ts / DAY);
  const ensureDay = (day: number): { tokens: number; messages: number; sessions: number; byModel: Map<string, number> } => {
    let p = dayMap.get(day);
    if (!p) {
      p = { tokens: 0, messages: 0, sessions: 0, byModel: new Map() };
      dayMap.set(day, p);
    }
    return p;
  };

  for (const info of infos) {
    try {
      const manager = SessionManager.open(info.path);
      const entries = manager.getBranch();
      let sessionTokens = 0;
      const createdMs = info.created.getTime();
      const modifiedMs = info.modified.getTime();
      ensureDay(dayAt(modifiedMs)).sessions += 1;
      for (const entry of entries) {
        if (entry.type !== "message") continue;
        messageCount += 1;
        const day = dayAt(typeof entry.timestamp === "number" ? entry.timestamp : modifiedMs);
        const dayPoint = ensureDay(day);
        dayPoint.messages += 1;
        const m = entry.message as {
          role?: unknown;
          model?: unknown;
          provider?: unknown;
          usage?: { totalTokens?: unknown; input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown; cost?: { total?: unknown } };
        };
        if (m.role !== "assistant" || m.usage === undefined) continue;
        const u = m.usage;
        const tokens = typeof u.totalTokens === "number"
          ? u.totalTokens
          : Number(u.input ?? 0) + Number(u.output ?? 0) + Number(u.cacheRead ?? 0) + Number(u.cacheWrite ?? 0);
        const cost = typeof u.cost?.total === "number" ? u.cost.total : 0;
        totalTokens += tokens;
        totalCost += cost;
        sessionTokens += tokens;
        dayPoint.tokens += tokens;
        const key = `${String(m.provider ?? "unknown")}/${String(m.model ?? "unknown")}`;
        const cur = byModel.get(key) ?? { tokens: 0, cost: 0 };
        byModel.set(key, { tokens: cur.tokens + tokens, cost: cur.cost + cost });
        dayPoint.byModel.set(key, (dayPoint.byModel.get(key) ?? 0) + tokens);
      }
      if (sessionTokens > peakTokens) peakTokens = sessionTokens;
      if (modifiedMs - createdMs > maxDurationMs) maxDurationMs = modifiedMs - createdMs;
      if (firstTs === 0 || createdMs < firstTs) firstTs = createdMs;
      if (modifiedMs > lastTs) lastTs = modifiedMs;
      activeDates.add(dayAt(modifiedMs));
    } catch {
      // Skip unreadable session files.
    }
  }

  const daily: UsageDailyPoint[] = [...dayMap.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(([day, p]) => ({
      ts: day * DAY,
      tokens: p.tokens,
      messages: p.messages,
      sessions: p.sessions,
      byModel: Object.fromEntries(p.byModel),
    }));
  const perModel: UsageStatModel[] = [...byModel.entries()]
    .map(([model, v]) => ({ model, tokens: v.tokens, cost: v.cost }))
    .toSorted((a, b) => b.tokens - a.tokens);
  // Streaks: consecutive days with session activity (day = floor of epoch days).
  const dates = [...activeDates].toSorted((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < dates.length; i++) {
    run = i === 0 || dates[i] === (dates[i - 1] ?? 0) + 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }
  const today = Math.floor(Date.now() / DAY);
  let currentStreak = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] === today - currentStreak) {
      currentStreak++;
    } else {
      break;
    }
  }
  return {
    totalTokens,
    totalCost,
    sessionCount: infos.length,
    messageCount,
    peakTokens,
    maxDurationMs,
    firstTs,
    lastTs,
    currentStreak,
    longestStreak,
    activeDays: dayMap.size,
    perModel,
    daily,
  };
}
