import { useMemo, useState } from "react";
import { useTheme, useTokens } from "@vagus/ui-tokens";
import type { UsageStatsUI, UsageDailyPointUI } from "@vagus/ui-tokens";
import { useSurfaceBg } from "./shared";

/**
 * Usage statistics dashboard — full-width, info-rich redesign.
 *
 * Layout:
 *   1. Stat banner   — tokens / cost / peak session / sessions / messages / days
 *   2. Heatmap       — full-year activity (day|week), month axis, hover detail
 *   3. Model usage   — token share ranking vs cost share ranking (side by side)
 *   4. Trends        — daily token stack + daily cost bars (side by side)
 *   5. Footer        — longest streak, active days, first/last activity
 */

const DAY = 86_400_000;
const BAR_COLORS = ["#6366F1", "#22D3EE", "#FBBF24", "#F472B6", "#34D399", "#A78BFA", "#F87171", "#60A5FA"];
const HEAT_COLORS_LIGHT = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const HEAT_COLORS_DARK = ["#272b33", "#0e4429", "#006d32", "#26a641", "#39d353"];

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtCost(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}K`;
  if (n >= 100) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function streakDays(daily: UsageDailyPointUI[]): { current: number; longest: number } {
  const days = [...new Set(daily.map((d) => Math.floor(d.ts / DAY)))].toSorted((a, b) => a - b);
  let longest = 0, run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i === 0 || days[i] === (days[i - 1] ?? 0) + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const today = Math.floor(Date.now() / DAY);
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i] === today - current) current++;
    else break;
  }
  return { current, longest };
}

function aggregateByModel(daily: UsageDailyPointUI[]): Array<{ model: string; tokens: number }> {
  const map = new Map<string, number>();
  for (const d of daily) {
    for (const [model, tokens] of Object.entries(d.byModel)) {
      map.set(model, (map.get(model) ?? 0) + tokens);
    }
  }
  return [...map.entries()].map(([model, tokens]) => ({ model, tokens })).toSorted((a, b) => b.tokens - a.tokens);
}

/* ─────────────── 1. Stat banner ─────────────── */

function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }): JSX.Element {
  const t = useTokens();
  const surfaceBg = useSurfaceBg();
  return (
    <div style={{ background: surfaceBg, border: `1px solid ${t.color.border}`, borderRadius: 14, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, color: t.color.muted, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ?? t.color.fg, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub !== undefined && <div style={{ fontSize: 11.5, color: t.color.muted }}>{sub}</div>}
    </div>
  );
}

/* ─────────────── 2. Heatmap ─────────────── */

function ActivityHeatmap({ daily }: { daily: UsageDailyPointUI[] }): JSX.Element {
  const t = useTokens();
  const { theme } = useTheme();
  const [tip, setTip] = useState<{ x: number; y: number; date: string; tokens: number } | null>(null);
  const palette = theme === "light" ? HEAT_COLORS_LIGHT : HEAT_COLORS_DARK;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const startMs = todayMs - 52 * 7 * DAY;

  const intensity = new Map<string, number>();
  const tokensByDay = new Map<string, number>();
  // Logarithmic intensity: map the whole token range to 1..4 via log2 so
  // that every order of magnitude gets a distinct colour. 0 = no data.
  const maxDay = Math.max(...daily.map((d) => d.tokens), 0);
  const maxLog = maxDay > 0 ? Math.log2(maxDay) : 1;
  for (const d of daily) {
    const day = localDayKey(new Date(d.ts));
    const lvl = d.tokens === 0 ? 0 : Math.max(1, Math.min(4, Math.round((Math.log2(d.tokens) / maxLog) * 4)));
    intensity.set(day, lvl);
    tokensByDay.set(day, d.tokens);
  }

  const startDay = new Date(startMs);
  const monday = new Date(startDay);
  monday.setDate(monday.getDate() - ((startDay.getDay() + 6) % 7));
  const mondayMs = monday.getTime();
  const weeks: number[] = [];
  for (let step = 0; mondayMs + step * 7 * DAY < todayMs + DAY; step++) weeks.push(mondayMs + step * 7 * DAY);

  const CELL = 13, GAP = 3, MONTH_H = 20;
  const W = weeks.length * (CELL + GAP);
  const H = 7 * (CELL + GAP) + MONTH_H;
  const dw = ["", "Mon", "", "Wed", "", "Fri", ""];

  const monthLabels: Array<{ x: number; label: string }> = [];
  {
    let lastKey = -1;
    let startX = 0;
    for (let ci = 0; ci < weeks.length; ci++) {
      const w = weeks[ci];
      if (w === undefined) continue;
      const d = new Date(w);
      const key = d.getFullYear() * 100 + d.getMonth();
      if (key !== lastKey) {
        if (lastKey !== -1) {
          const span = ci * (CELL + GAP) - startX;
          monthLabels.push({ x: startX + span / 2, label: `${lastKey % 100 + 1}月` });
        }
        lastKey = key;
        startX = ci * (CELL + GAP);
      }
    }
    if (lastKey !== -1) {
      const span = weeks.length * (CELL + GAP) - startX;
      monthLabels.push({ x: startX + span / 2, label: `${lastKey % 100 + 1}月` });
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", position: "relative" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: GAP, paddingTop: 14 }}>
        {dw.map((l, i) => (
          <div key={i} style={{ height: CELL, lineHeight: `${CELL}px`, fontSize: 9, color: t.color.muted, textAlign: "right", paddingRight: 4 }}>{l}</div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMinYMin meet" style={{ display: "block" }}>
          {weeks.map((w, ci) =>
            Array.from({ length: 7 }, (_, ri) => {
              const d = new Date(new Date(w).getTime() + ri * DAY);
              const key = localDayKey(d);
              const isFuture = d.getTime() > todayMs;
              const lvl = isFuture ? 0 : (intensity.get(key) ?? 0);
              const fill = palette[lvl] ?? palette[0];
              const x = ci * (CELL + GAP);
              const y = ri * (CELL + GAP);
              const tokens = isFuture ? 0 : (tokensByDay.get(key) ?? 0);
              return (
                <rect
                  key={key}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={2.5}
                  fill={fill}
                  onMouseMove={(e) => { if (!isFuture) setTip({ x: e.clientX, y: e.clientY, date: key, tokens }); }}
                  onMouseLeave={() => setTip(null)}
                />
              );
            }),
          )}
          {monthLabels.map((ml, i) => (
            <text key={`${ml.label}-${i}`} x={ml.x} y={7 * (CELL + GAP) + MONTH_H - 4} fontSize={9} fill={t.color.muted} textAnchor="middle">{ml.label}</text>
          ))}
        </svg>
      </div>
      {tip !== null && (
        <div style={{
          position: "fixed", left: tip.x + 12, top: tip.y + 12, zIndex: 200, pointerEvents: "none",
          background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: 8,
          padding: "8px 10px", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", color: t.color.fg, minWidth: 110,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{tip.date}</div>
          <div style={{ color: t.color.muted }}>{tip.tokens > 0 ? `${fmt(tip.tokens)} tokens` : "无活跃"}</div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 4, alignSelf: "flex-end", fontSize: 10, color: t.color.muted }}>
        <span>较少</span>
        {palette.map((c) => <span key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />)}
        <span>较多</span>
      </div>
    </div>
  );
}

/* ─────────────── 3. Model ranking (tokens & cost) ─────────────── */

function ModelRanking({ title, rows, total, mode }: {
  title: string;
  rows: Array<{ model: string; value: number }>;
  total: number;
  mode: "tokens" | "cost";
}): JSX.Element {
  const t = useTokens();
  const surfaceBg = useSurfaceBg();
  const top = rows.slice(0, 6);
  const others = rows.slice(6).reduce((s, r) => s + r.value, 0);
  const display = others > 0 ? [...top, { model: "其他", value: others }] : top;
  return (
    <div style={{ background: surfaceBg, border: `1px solid ${t.color.border}`, borderRadius: 14, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: t.color.fg, marginBottom: 16 }}>{title}</div>
      {display.length === 0 ? (
        <div style={{ fontSize: 12, color: t.color.muted, padding: "8px 0" }}>暂无数据。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {display.map((m, i) => {
            const pct = total > 0 ? (m.value / total) * 100 : 0;
            const color = BAR_COLORS[i % BAR_COLORS.length];
            const isOther = m.model === "其他";
            const [provider, model] = isOther ? [undefined, "其他"] : m.model.split("/");
            return (
              <div key={m.model} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, color: t.color.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {provider !== undefined && <span style={{ color: t.color.muted }}>{provider}/</span>}
                    {model}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: t.color.fg, fontVariantNumeric: "tabular-nums" }}>
                    {mode === "cost" ? fmtCost(m.value) : fmt(m.value)}
                  </span>
                  <span style={{ width: 44, fontSize: 11, color: t.color.muted, textAlign: "right" }}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: t.color.border, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.max(1, pct)}%`, background: color, borderRadius: 3 }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Main view ─────────────── */

export function UsageView({ stats, t }: { stats: UsageStatsUI | null; t: ReturnType<typeof useTokens> }): JSX.Element {
  const surfaceBg = useSurfaceBg();

  const daily = useMemo(() => stats?.daily ?? [], [stats]);
  const totalTokens = daily.reduce((s, d) => s + d.tokens, 0);
  const totalCost = stats?.totalCost ?? 0;
  const totalSessions = stats?.sessionCount ?? daily.reduce((s, d) => s + d.sessions, 0);
  const totalMessages = stats?.messageCount ?? daily.reduce((s, d) => s + d.messages, 0);
  const activeDays = daily.length;
  const peakTokens = stats?.peakTokens ?? 0;
  const maxDurationMs = stats?.maxDurationMs ?? 0;
  const streaks = useMemo(() => streakDays(daily), [daily]);
  const byModel = useMemo(() => aggregateByModel(daily), [daily]);
  const firstPoint = daily.length > 0 ? daily[0] : undefined;
  const lastPoint = daily.length > 0 ? daily[daily.length - 1] : undefined;
  const firstDay = firstPoint !== undefined ? new Date(firstPoint.ts) : null;
  const lastDay = lastPoint !== undefined ? new Date(lastPoint.ts) : null;
  const avgPerDay = activeDays > 0 ? totalTokens / activeDays : 0;
  const longestSessionHours = maxDurationMs > 0 ? (maxDurationMs / 3_600_000).toFixed(1) : "—";

  // Cost-by-model from perModel (service-side) when present.
  const costByModel = useMemo(
    () => (stats?.perModel ?? []).map((m) => ({ model: m.model, value: m.cost })).toSorted((a, b) => b.value - a.value),
    [stats],
  );
  const costTotal = costByModel.reduce((s, m) => s + m.value, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: t.color.fg }}>使用统计</span>
          <span style={{ fontSize: 13, color: t.color.muted, borderBottom: `2px solid ${t.color.primary}`, paddingBottom: 2 }}>应用用量</span>
        </div>
      </div>

      {stats === null ? (
        <div style={{ color: t.color.muted, fontSize: 13, padding: "60px 0", textAlign: "center" }}>加载中…</div>
      ) : (
        <>
          {/* 1. Stat banner */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <StatTile label="Tokens 总用量" value={fmt(totalTokens)} sub="input + output（不含缓存复读）" />
            <StatTile label="总花费" value={fmtCost(totalCost)} accent="#F472B6" sub={avgPerDay > 0 ? `日均 ${fmt(avgPerDay)} tokens` : undefined} />
            <StatTile label="峰值单会话" value={fmt(peakTokens)} sub={longestSessionHours !== "—" ? `最长会话 ${longestSessionHours} 小时` : "暂无"} />
            <StatTile label="会话数" value={String(totalSessions)} />
            <StatTile label="消息数" value={String(totalMessages)} />
            <StatTile label="活跃天数" value={String(activeDays)} sub={firstDay !== null ? `自 ${firstDay.getFullYear()}年${firstDay.getMonth() + 1}月起` : "暂无数据"} />
          </div>

          {/* 2. Heatmap */}
          <div style={{ background: surfaceBg, border: `1px solid ${t.color.border}`, borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: t.color.fg }}>活跃热力图</div>
              <div style={{ fontSize: 12, color: t.color.muted }}>
                {totalTokens > 0 ? `累计 ${fmt(totalTokens)} tokens · 当前连击 ${streaks.current} 天` : "暂无活跃数据"}
              </div>
            </div>
            {daily.length === 0 ? (
              <div style={{ fontSize: 12, color: t.color.muted, padding: "8px 0" }}>暂无活跃数据。</div>
            ) : (
              <ActivityHeatmap daily={daily} />
            )}
          </div>

          {/* 3. Model usage + cost ranking (side by side, full width each row on wide screens) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
            <ModelRanking title="模型用量（Token 占比）" rows={byModel.map((m) => ({ model: m.model, value: m.tokens }))} total={totalTokens} mode="tokens" />
            <ModelRanking title="模型花费（USD 占比）" rows={costByModel} total={costTotal} mode="cost" />
          </div>

          {/* 4. Footer */}
          <div style={{ display: "flex", gap: 28, fontSize: 12, color: t.color.muted, paddingTop: 4, flexWrap: "wrap" }}>
            <span>最长连击 <b style={{ color: t.color.fg }}>{streaks.longest}</b> 天</span>
            <span>最近活跃 <b style={{ color: t.color.fg }}>{lastDay !== null ? `${lastDay.getMonth() + 1}月${lastDay.getDate()}日` : "—"}</b></span>
            {firstDay !== null && <span>起始于 <b style={{ color: t.color.fg }}>{firstDay.getFullYear()}年{firstDay.getMonth() + 1}月{firstDay.getDate()}日</b></span>}
          </div>
        </>
      )}
    </div>
  );
}