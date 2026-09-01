import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { UsageDailyPoint, UsageStats, UsageStatModel } from "@vagus/protocol";

/**
 * Aggregates token/cost usage across all persisted sessions (pi JSONL).
 * Each assistant message carries a `usage` record (tokens + cost); this
 * sums them per session and per model. Used by the settings usage panel.
 *
 * Pure function — no engine state; reads pi's session store directly.
 */
/** Local-midnight epoch ms — the natural "day" key. Not floor(ts/DAY): that
 *  re-normalizes to a UTC boundary (local midnight in UTC+8 lands at 16:00
 *  UTC the previous day), shifting daily buckets by one. */
function dayAt(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export async function aggregateUsageStats(): Promise<UsageStats> {
  const infos = await SessionManager.listAll();  let totalTokens = 0;
  let totalCost = 0;
  let messageCount = 0;
  let peakTokens = 0;
  let maxDurationMs = 0;
  let firstTs = 0;
  let lastTs = 0;
  const byModel = new Map<string, { tokens: number; cost: number }>();
  const activeDates = new Set<number>();
  const DAY = 86_400_000;
  const dayMap = new Map<number, { tokens: number; messages: number; sessions: number; cost: number; byModel: Map<string, number> }>();
  const ensureDay = (day: number): { tokens: number; messages: number; sessions: number; cost: number; byModel: Map<string, number> } => {
    let p = dayMap.get(day);
    if (!p) {
      p = { tokens: 0, messages: 0, sessions: 0, cost: 0, byModel: new Map() };
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
        // Real consumption = fresh input + output. cacheRead re-bills the same
        // context every turn (it is NOT new spend), so counting it inflates
        // totals ~10x (e.g. 4.4G vs 0.44G on real data). Cost already prices
        // cacheRead at the discounted rate inside cost.total, so it stays.
        const tokens = Number(u.input ?? 0) + Number(u.output ?? 0);
        const cost = typeof u.cost?.total === "number" ? u.cost.total : 0;
        totalTokens += tokens;
        totalCost += cost;
        sessionTokens += tokens;
        dayPoint.tokens += tokens;
        dayPoint.cost += cost;
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
      ts: day,
      tokens: p.tokens,
      cost: p.cost,
      messages: p.messages,
      sessions: p.sessions,
      byModel: Object.fromEntries(p.byModel),
    }));
  const perModel: UsageStatModel[] = [...byModel.entries()]
    .map(([model, v]) => ({ model, tokens: v.tokens, cost: v.cost }))
    .toSorted((a, b) => b.tokens - a.tokens);
  // Streaks: consecutive days with session activity (dates are local-midnight ms).
  const dates = [...activeDates].toSorted((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < dates.length; i++) {
    run = i === 0 || dates[i] === (dates[i - 1] ?? 0) + DAY ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }
  const today = new Date(
    new Date().getFullYear(), new Date().getMonth(), new Date().getDate(),
  ).getTime();
  let currentStreak = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i] === today - currentStreak * DAY) {
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
