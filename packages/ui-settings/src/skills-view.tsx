import { useCallback, useEffect, useState } from "react";
import type { useTokens } from "@vagus/ui-tokens";
import { useTheme } from "@vagus/ui-tokens";

/**
 * Skills pane (设置 → Agents 能力 → 技能).
 *
 * Shows the deduped global skills vagusPI loads for every session — the union
 * of `~/.vagus/agent/skills` (Vagus-private) and `~/.agents/skills` (shared
 * across harnesses), with vagusPI winning on a name clash. Pure read view: the
 * daemon does the discovery/dedup; this component renders it.
 */

/** Builtin semantic icon set — reuse the wrench + box glyphs. */
const ICONS: Record<string, JSX.Element> = {
  wrench: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L3 18v3h3l5.3-5.3a4.5 4.5 0 0 0 6.4-6.4l-3 3-2.3-2.3 3-3z" /></svg>
  ),
  box: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l9 4 9-4M3 12l9 4 9-4M3 7l9 4 9-4-9-4z" /></svg>
  ),
  puzzle: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 7a4 4 0 1 1 3 6.9c-.8-.4-1.3-1.2-1.3-2.1V9h-2.8A2.8 2.8 0 0 1 10 6.2c0-.8.3-1.5.8-2.1A4 4 0 0 1 14 7z" /><path d="M4 14a4 4 0 0 0 6.9 3A4 4 0 0 0 5 12.7h2.8V10A2.8 2.8 0 0 1 11.8 8c.8 0 1.5.3 2.1.8a4 4 0 0 0-3 6.9V14H7.6z" /></svg>
  ),
};
const FALLBACK_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
);

/** Source metadata for a discovered skill. */
interface SkillEntry {
  name: string;
  description: string;
  path: string;
  source: "local" | "agents" | "package" | "project";
  /** Whether the user has enabled this skill (default true). */
  enabled: boolean;
}

interface SkillsViewProps {
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  t: ReturnType<typeof useTokens>;
}

/** Keep the last list visible when switching categories away and back. */
let skillsMemoryCache: SkillEntry[] | undefined;

export function SkillsView({ request, t }: SkillsViewProps): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const [skills, setSkills] = useState<SkillEntry[]>(() => skillsMemoryCache ?? []);
  const [loading, setLoading] = useState(skillsMemoryCache === undefined);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  const apply = useCallback((list: SkillEntry[]) => {
    skillsMemoryCache = list;
    setSkills(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = (await request("skills.list")) as SkillEntry[];
        if (!cancelled) {
          apply(list);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && skillsMemoryCache === undefined) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, request]);

  const toggleSkill = useCallback(
    async (skill: SkillEntry) => {
      setBusyName(skill.name);
      setError(null);
      try {
        const next = (await request("skills.setEnabled", { name: skill.name, enabled: !skill.enabled })) as SkillEntry[];
        apply(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "切换失败");
      } finally {
        setBusyName(null);
      }
    },
    [apply, request],
  );

  const agentsCount = skills.filter((s) => s.source === "agents").length;

  const sourceMeta: Record<string, { label: string; accent: string; icon: string }> = {
    local: { label: "本地", accent: "#818cf8", icon: "wrench" },
    agents: { label: "共享", accent: "#34d399", icon: "box" },
    package: { label: "包", accent: "#f59e0b", icon: "puzzle" },
    project: { label: "项目", accent: "#3b82f6", icon: "layers" },
  };

  return (
    <div>
      {/* Heading */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: t.color.fg }}>技能</h1>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8, fontSize: 12.5, color: t.color.muted }}>
          <span>全局可复用的技能包，按名称去重</span>
          {!loading && skills.length > 0 && (
            <>
              <span aria-hidden="true" style={{ color: t.color.border }}>·</span>
              <span>{skills.length} 个技能</span>
              <span aria-hidden="true" style={{ color: t.color.border }}>·</span>
              <span>{agentsCount} 共享</span>
            </>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, lineHeight: 1.55, color: t.color.error, background: isDark ? "rgba(248,81,73,0.09)" : "rgba(220,38,38,0.05)", border: `1px solid ${isDark ? "rgba(248,81,73,0.24)" : "rgba(220,38,38,0.18)"}`, borderRadius: 11, padding: "10px 13px", marginBottom: 18 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginTop: 1, flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 17h.01" /></svg>
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "40px 0", color: t.color.muted, fontSize: 13 }}>
          <span style={{ width: 13, height: 13, flexShrink: 0, border: "2px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", animation: "sk-spin 700ms linear infinite" }} />
          正在读取技能…
        </div>
      )}

      {!loading && skills.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 200, color: t.color.muted }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: t.color.muted, background: isDark ? "rgba(15,17,23,0.5)" : "rgba(245,246,250,0.9)", marginBottom: 12 }}>{ICONS.box}</div>
          <div style={{ color: t.color.fg, fontSize: 14, fontWeight: 650 }}>暂无全局技能</div>
          <div style={{ marginTop: 5, fontSize: 12.5 }}>在 ~/.pi/agent/skills/ 或 ~/.agents/skills/ 添加 SKILL.md。</div>
        </div>
      )}

      {!loading && skills.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {skills.map((skill, index) => {
            const meta = sourceMeta[skill.source] ?? { label: "其他", accent: "#8b90a0", icon: "box" };
            const isLast = index === skills.length - 1;
            return (
              <div
                key={`${skill.source}:${skill.name}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 13,
                  padding: "11px 10px",
                  borderRadius: 10,
                  borderBottom: isLast ? "none" : `1px solid ${t.color.border}`,
                  transition: "background 140ms ease",
                  opacity: busyName === skill.name ? 0.6 : 1,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isDark ? "rgba(129,140,248,0.07)" : "rgba(99,102,241,0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Icon — source-tinted chip */}
                <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: `${meta.accent}16`, color: meta.accent, border: `1px solid ${meta.accent}28`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ transform: "scale(1.1)", display: "flex" }}>{ICONS[meta.icon] ?? FALLBACK_ICON}</span>
                </div>

                {/* Name + description + path */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <h3 style={{ margin: 0, fontSize: 13.5, lineHeight: 1.3, fontWeight: 660, color: t.color.fg }}>{skill.name}</h3>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, lineHeight: 1, fontWeight: 650, color: meta.accent, background: `${meta.accent}16`, border: `1px solid ${meta.accent}28`, borderRadius: 999, padding: "2.5px 7px" }}>
                      {meta.label}
                    </span>
                  </div>
                  {skill.description && (
                    <p style={{ margin: "3px 0 0", fontSize: 12, lineHeight: 1.5, color: t.color.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {skill.description}
                    </p>
                  )}
                  <div style={{ marginTop: 4, fontSize: 10.5, color: t.color.muted, fontFamily: t.font.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {skill.path}
                  </div>
                </div>

                {/* Enable toggle */}
                <button
                  role="switch"
                  aria-checked={skill.enabled}
                  aria-label={`${skill.enabled ? "禁用" : "启用"}技能 ${skill.name}`}
                  disabled={busyName === skill.name}
                  onClick={() => void toggleSkill(skill)}
                  style={{
                    width: 40,
                    height: 22,
                    borderRadius: 99,
                    border: "none",
                    cursor: "pointer",
                    position: "relative",
                    flexShrink: 0,
                    background: skill.enabled ? "linear-gradient(120deg, #818cf8, #8b5cf6)" : t.color.border,
                    transition: "background 150ms ease",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: skill.enabled ? 20 : 2,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                      transition: "left 150ms ease",
                    }}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes sk-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          [data-theme] * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
        }
      `}</style>
    </div>
  );
}
