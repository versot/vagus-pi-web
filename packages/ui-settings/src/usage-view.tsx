import { useMemo, useState } from "react";
import { useTheme, useTokens } from "@vagus/ui-tokens";
import type { UsageStatsUI, UsageDailyPointUI } from "@vagus/ui-tokens";
import { useSurfaceBg } from "./shared.js";

const DAY = 86_400_000;
const BAR_COLORS = ["#6366F1", "#22D3EE", "#FBBF24", "#F472B6", "#34D399", "#A78BFA", "#F87171", "#60A5FA"];
// Heatmap ramps: light (GitHub light) vs dark (GitHub dark contribution colors).
const HEAT_COLORS_LIGHT = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const HEAT_COLORS_DARK = ["#21262d", "#0e4429", "#006d32", "#26a641", "#39d353"];

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Compute current streak from filtered daily days. */
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

/* ── Segmented control for time range ── */

function SegmentedTimeline({ value, onChange, t }: { value: number; onChange: (v: number) => void; t: ReturnType<typeof useTokens> }): JSX.Element {
  const opts = [
    { v: 7 as const, label: "最近 7 天" },
    { v: 30 as const, label: "最近 30 天" },
  ];
  return (
    <div style={{ display: "inline-flex", background: t.color.bg, border: `1px solid ${t.color.border}`, borderRadius: 9, padding: 3, gap: 2 }}>
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{
            border: "none", background: active ? t.color.surface : "transparent",
            color: active ? t.color.fg : t.color.muted,
            borderRadius: 6, padding: "5px 14px", fontSize: 12.5, fontWeight: active ? 500 : 400,
            cursor: "pointer", transition: "all 0.15s",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

/* ── Stat Card ── */

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }): JSX.Element {
  const t = useTokens();
  const surfaceBg = useSurfaceBg();
  return (
    <div style={{ background: surfaceBg, border: `1px solid ${t.color.border}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: t.color.muted, display: "flex", flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 11.5, color: t.color.muted }}>{label}</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: t.color.fg, letterSpacing: "-0.02em" }}>{value}</div>
      {sub !== undefined && <div style={{ fontSize: 12, color: t.color.muted }}>{sub}</div>}
    </div>
  );
}

/* ── Activity Heatmap (GitHub-style) ── */

function ActivityHeatmap({ daily, range }: { daily: UsageDailyPointUI[]; range: number }): JSX.Element {
  const t = useTokens();
  const { theme } = useTheme();
  const [tip, setTip] = useState<{ x: number; y: number; date: string; tokens: number } | null>(null);
  const palette = theme === "light" ? HEAT_COLORS_LIGHT : HEAT_COLORS_DARK;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const startMs = todayMs - range * DAY;
  const intensity = new Map<string, number>();
  const tokensByDay = new Map<string, number>();
  for (const d of daily) {
    const day = new Date(d.ts).toISOString().slice(0, 10);
    const lvl = d.tokens === 0 ? 0 : Math.min(4, Math.floor(Math.log2(d.tokens) / 2) + 1);
    intensity.set(day, lvl);
    tokensByDay.set(day, d.tokens);
  }
  const startDay = new Date(startMs);
  const dayOfWeek = startDay.getDay(); // 0=Sun
  const monday = new Date(startDay);
  monday.setDate(monday.getDate() - ((dayOfWeek + 6) % 7)); // back to Monday
  const weeks: number[] = [];
  const endDate = new Date(todayMs + DAY);
  const cursor = new Date(monday);
  for (let step = 0; cursor.getTime() < endDate.getTime(); step++) {
    weeks.push(cursor.getTime());
    cursor.setDate(monday.getDate() + 7 * (step + 1));
  }
  const CELL = 10, GAP = 2;
  const W = weeks.length * (CELL + GAP);
  const H = 7 * (CELL + GAP);
  const dw = ["", "Mon", "", "Wed", "", "Fri", ""];
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", position: "relative" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: GAP, paddingTop: 14 }}>
        {dw.map((l, i) => (
          <div key={i} style={{ height: CELL, lineHeight: `${CELL}px`, fontSize: 9, color: t.color.muted, textAlign: "right", paddingRight: 4 }}>{l}</div>
        ))}
      </div>
      <svg width={W} height={H} style={{ flexShrink: 0 }}>
        {weeks.map((w, ci) =>
          Array.from({ length: 7 }, (_, ri) => {
            const d = new Date(new Date(w).getTime() + ri * DAY);
            const key = d.toISOString().slice(0, 10);
            const lvl = intensity.get(key) ?? 0;
            const fill = palette[lvl] ?? palette[0];
            const x = ci * (CELL + GAP);
            const y = ri * (CELL + GAP);
            const tokens = tokensByDay.get(key) ?? 0;
            const inRange = d.getTime() >= startMs && d.getTime() <= todayMs;
            return (
              <rect
                key={key}
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={2}
                fill={fill}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, date: key, tokens })}
                onMouseLeave={() => setTip(null)}
                style={{ cursor: inRange ? "pointer" : "default", opacity: inRange ? 1 : 0.35 }}
              />
            );
          }),
        )}
      </svg>
      {tip !== null && (
        <div style={{
          position: "fixed", left: tip.x + 12, top: tip.y + 12, zIndex: 200, pointerEvents: "none",
          background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: 8,
          padding: "8px 10px", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", color: t.color.fg, minWidth: 120,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{tip.date}</div>
          <div style={{ color: t.color.muted }}>{tip.tokens > 0 ? `${fmt(tip.tokens)} tokens` : "无活跃"}</div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", alignSelf: "flex-end", fontSize: 10, color: t.color.muted }}>
        <span>较少</span>
        {palette.map((c) => <span key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />)}
        <span>较多</span>
      </div>
    </div>
  );
}

/* ── Stacked Bar Chart ── */

function StackedBarChart({ daily, range }: { daily: UsageDailyPointUI[]; range: number }): JSX.Element {
  const t = useTokens();
  const [tip, setTip] = useState<{ x: number; y: number; day: UsageDailyPointUI } | null>(null);
  const CHART_W = 600, CHART_H = 180, PAD = { top: 10, bottom: 26, left: 0, right: 0 };
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const maxY = Math.max(...daily.map((d) => d.tokens), 1);
  const barW = Math.max(4, Math.min(12, innerW / daily.length - 2));
  const allModels = [...new Set(daily.flatMap((d) => Object.keys(d.byModel)))].slice(0, 8);
  const labelInterval = Math.max(1, Math.floor(daily.length / 6));
  return (
    <div style={{ position: "relative" }}>
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ display: "block" }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = PAD.top + innerH * (1 - pct);
          return (
            <g key={pct}>
              <line x1={PAD.left} y1={y} x2={CHART_W - PAD.right} y2={y} stroke={t.color.border} strokeWidth={0.5} strokeDasharray="3 3" />
              <text x={PAD.left + 4} y={y - 2} fontSize={9} fill={t.color.muted}>{fmt(Math.round(maxY * pct))}</text>
            </g>
          );
        })}
        {/* Bars */}
        {daily.map((d, i) => {
          const x = PAD.left + (i / daily.length) * innerW + (innerW / daily.length - barW) / 2;
          let yOffset = 0;
          return (
            <g key={i}>
              {allModels.map((model) => {
                const val = d.byModel[model] ?? 0;
                if (val === 0) return null;
                const h = (val / maxY) * innerH;
                const bar = (
                  <rect
                    key={model}
                    x={x}
                    y={PAD.top + innerH - yOffset - h}
                    width={barW}
                    height={Math.max(1, h)}
                    fill={BAR_COLORS[allModels.indexOf(model) % BAR_COLORS.length]}
                    rx={1}
                  />
                );
                yOffset += h;
                return bar;
              })}
              {/* Hover hit area */}
              <rect
                x={PAD.left + (i / daily.length) * innerW}
                y={PAD.top}
                width={innerW / daily.length}
                height={innerH}
                fill="transparent"
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, day: d })}
                onMouseLeave={() => setTip(null)}
              />
            </g>
          );
        })}
        {/* X labels */}
        {daily.map((d, i) =>
          i % labelInterval === 0 ? (
            <text key={i} x={PAD.left + (i / daily.length) * innerW + (innerW / daily.length) / 2} y={CHART_H - 7} fontSize={10} fill={t.color.muted} textAnchor="middle">{fmtDate(d.ts)}</text>
          ) : null,
        )}
      </svg>
      {/* Legend — outside the SVG so it never collides with the date labels;
          wraps to a new line when the model list grows. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 10 }}>
        {allModels.map((model, i) => (
          <div key={model} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: BAR_COLORS[i % BAR_COLORS.length], flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: t.color.muted, whiteSpace: "nowrap" }}>{model.split("/").pop()}</span>
          </div>
        ))}
      </div>
      {/* Tooltip */}
      {tip !== null && (
        <div style={{
          position: "fixed", left: tip.x + 12, top: tip.y + 12, zIndex: 200, pointerEvents: "none",
          background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: 8,
          padding: "8px 10px", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", color: t.color.fg, minWidth: 140,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{fmtDate(tip.day.ts)}</div>
          {Object.entries(tip.day.byModel).map(([model, tokens]) => (
            <div key={model} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: BAR_COLORS[allModels.indexOf(model) % BAR_COLORS.length], flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.split("/").pop()}</span>
              <span style={{ fontWeight: 500 }}>{fmt(tokens)}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${t.color.border}`, marginTop: 4, paddingTop: 4, display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: t.color.muted }}>合计</span>
            <span style={{ fontWeight: 600 }}>{fmt(tip.day.tokens)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Donut Chart ── */

function DonutChart({ segments, total }: { segments: Array<{ model: string; tokens: number; color: string }>; total: number }): JSX.Element {
  const t = useTokens();
  const [tip, setTip] = useState<{ x: number; y: number; seg: { model: string; tokens: number; color: string }; pct: number } | null>(null);
  const cx = 100, cy = 100, r = 70, sw = 28;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <svg width="100%" viewBox="0 0 200 200" style={{ maxWidth: 200 }}>
        {segments.map((seg) => {
          const pct = total > 0 ? seg.tokens / total : 0;
          const len = pct * circumference;
          const dasharray = `${len} ${circumference - len}`;
          const segEl = (
            <circle
              key={seg.model}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={sw}
              strokeDasharray={dasharray}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, seg, pct: Math.round(pct * 100) })}
              onMouseLeave={() => setTip(null)}
              style={{ cursor: "pointer" }}
            />
          );
          offset += len;
          return segEl;
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={16} fontWeight={600} fill={t.color.fg}>{fmt(total)}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize={11} fill={t.color.muted}>tokens</text>
      </svg>
      {tip !== null && (
        <div style={{
          position: "fixed", left: tip.x + 12, top: tip.y + 12, zIndex: 200, pointerEvents: "none",
          background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: 8,
          padding: "8px 10px", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", color: t.color.fg, minWidth: 140,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: tip.seg.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>{tip.seg.model.split("/").pop()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: t.color.muted }}>{fmt(tip.seg.tokens)} tokens</span>
            <span style={{ fontWeight: 600 }}>{tip.pct}%</span>
          </div>
        </div>
      )}
      <div style={{ width: "100%" }}>
        {segments.map((seg, i) => {
          const pct = total > 0 ? Math.round((seg.tokens / total) * 100) : 0;
          return (
            <div key={seg.model} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < segments.length - 1 ? `1px solid ${t.color.border}` : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: t.color.fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seg.model.split("/").pop()}</span>
              <span style={{ fontSize: 11.5, color: t.color.muted, textAlign: "right" }}>{fmt(seg.tokens)} tokens</span>
              <span style={{ width: 40, fontSize: 12, fontWeight: 500, color: t.color.fg, textAlign: "right" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main UsageView ── */

export function UsageView({ stats, t }: { stats: UsageStatsUI | null; t: ReturnType<typeof useTokens> }): JSX.Element {
  const [range, setRange] = useState(30);
  const surfaceBg = useSurfaceBg();
  const cutoff = Date.now() - range * DAY;

  const filtered = useMemo(() => (stats?.daily ?? []).filter((d) => d.ts >= cutoff), [stats, range]);
  const rangeTokens = filtered.reduce((s, d) => s + d.tokens, 0);
  const rangeMessages = filtered.reduce((s, d) => s + d.messages, 0);
  const rangeSessions = filtered.reduce((s, d) => s + d.sessions, 0);
  const rangeActiveDays = filtered.length;
  const streaks = useMemo(() => streakDays(filtered), [filtered]);
  const rangeByModel = useMemo(() => aggregateByModel(filtered), [filtered]);
  const topModel = rangeByModel[0];
  const topPct = topModel !== undefined && rangeTokens > 0 ? Math.round((topModel.tokens / rangeTokens) * 100) : 0;
  const donutSegments = rangeByModel.slice(0, 6).map((m, i) => ({ ...m, color: BAR_COLORS[i % BAR_COLORS.length] ?? '#6366F1' }));

  // Simple icons
  const IconFlame = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>;
  const IconChat = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
  const IconMessage = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>;
  const IconCalendar = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
  const IconPulse = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 600, color: t.color.fg }}>使用统计</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: t.color.fg, borderBottom: `2px solid ${t.color.primary}`, paddingBottom: 2 }}>应用用量</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: t.color.muted }}>时间范围</span>
          <SegmentedTimeline value={range} onChange={setRange} t={t} />
        </div>
      </div>

      {stats === null ? (
        <div style={{ color: t.color.muted, fontSize: 13, padding: "60px 0", textAlign: "center" }}>加载中…</div>
      ) : (
        <>
          {/* 6 Stat Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
            <StatCard icon={IconFlame} label="Tokens 用量" value={fmt(rangeTokens)} />
            <StatCard icon={IconChat} label="会话数量" value={String(rangeSessions)} />
            <StatCard icon={IconMessage} label="消息数量" value={String(rangeMessages)} />
            <StatCard icon={IconCalendar} label="活跃天数" value={String(rangeActiveDays)} />
            <StatCard icon={IconCalendar} label="当前连续天数" value={String(streaks.current)} />
            <StatCard icon={IconPulse} label="最常用模型" value={topModel?.model.split("/").pop() ?? "—"} sub={topModel !== undefined ? `占比 ${topPct}%` : undefined} />
          </div>

          {/* Heatmap */}
          <div style={{ background: surfaceBg, border: `1px solid ${t.color.border}`, borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.color.fg, marginBottom: 14 }}>活跃热力图</div>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: t.color.muted, padding: "8px 0" }}>所选时间范围内暂无活跃数据。</div>
            ) : (
              <ActivityHeatmap daily={filtered} range={range} />
            )}
          </div>

          {/* Trend + Model Usage */}
          <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 500px", background: surfaceBg, border: `1px solid ${t.color.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.color.fg, marginBottom: 14 }}>按天 Token 趋势</div>
              {filtered.length === 0 ? (
                <div style={{ fontSize: 12, color: t.color.muted, padding: "8px 0" }}>暂无数据。</div>
              ) : (
                <StackedBarChart daily={filtered} range={range} />
              )}
            </div>
            <div style={{ flex: "1 1 320px", background: surfaceBg, border: `1px solid ${t.color.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.color.fg, marginBottom: 14 }}>模型用量</div>
              {donutSegments.length === 0 ? (
                <div style={{ fontSize: 12, color: t.color.muted, padding: "8px 0" }}>暂无数据。</div>
              ) : (
                <DonutChart segments={donutSegments} total={rangeTokens} />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}