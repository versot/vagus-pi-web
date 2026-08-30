import { useCallback, useEffect, useState } from "react";
import type { useTokens } from "@vagus/ui-tokens";
import { useTheme } from "@vagus/ui-tokens";

/**
 * Pi packages manager (home → 插件).
 *
 * Not a separate plugin market — this is pi's OWN package manager, rendered
 * as a web page. Installing here is identical to `pi install npm:@foo/bar`:
 * the daemon persists to ~/.pi/agent/settings.json `packages`, and pi's
 * PackageManager downloads the package. The pi TUI sees the same packages
 * (`pi list`), and packages installed in the TUI show up here.
 *
 * Sources supported (pi's format): npm:@scope/pkg, npm:pkg@1.0.0,
 * git:github.com/user/repo@v1, https://github.com/user/repo, or a local path.
 */

/** Package list item as served by the daemon's `plugin.list`. */
interface PiPackageInfo {
  source: string;
  scope: "user" | "project";
  installed: boolean;
  installedPath?: string;
  resources: { extensions: number; skills: number; prompts: number; themes: number };
}

const INSTALL_EXAMPLES = [
  "npm:@foo/pi-tools",
  "git:github.com/user/repo",
  "/absolute/path/to/package",
];

/** Brand gradient — indigo → violet (matches the old market visual language). */
const BRAND_GRADIENT = "linear-gradient(120deg, #818cf8 0%, #a78bfa 55%, #c084fc 100%)";

let memoryCache: PiPackageInfo[] | undefined;

interface PluginsViewProps {
  /** Thin RPC wrapper around client.request (method, params) → result. */
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  t: ReturnType<typeof useTokens>;
  /** Close the full-screen view (return to home). */
  onClose?: () => void;
}

/** Human-readable resource summary for a package row. */
function resourceLabel(p: PiPackageInfo): string {
  const parts: string[] = [];
  if (p.resources.extensions > 0) parts.push(`${p.resources.extensions} 扩展`);
  if (p.resources.skills > 0) parts.push(`${p.resources.skills} 技能`);
  if (p.resources.prompts > 0) parts.push(`${p.resources.prompts} 模板`);
  if (p.resources.themes > 0) parts.push(`${p.resources.themes} 主题`);
  return parts.length > 0 ? parts.join(" · ") : "未声明资源";
}

export function PluginsView({ request, t, onClose }: PluginsViewProps): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const [packages, setPackages] = useState<PiPackageInfo[]>(() => memoryCache ?? []);
  const [loading, setLoading] = useState(memoryCache === undefined);
  const [error, setError] = useState<string | null>(null);
  const [busySource, setBusySource] = useState<string | null>(null);
  const [installText, setInstallText] = useState("");
  const [installing, setInstalling] = useState(false);
  const [hoveredSource, setHoveredSource] = useState<string | null>(null);

  const applyList = useCallback((list: PiPackageInfo[]) => {
    memoryCache = list;
    setPackages(list);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const data = (await request("plugin.list")) as PiPackageInfo[];
    applyList(data);
    setError(null);
  }, [applyList, request]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = (await request("plugin.list")) as PiPackageInfo[];
        if (!cancelled) {
          applyList(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && memoryCache === undefined) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyList, request]);

  const install = async (source: string): Promise<void> => {
    const spec = source.trim();
    if (!spec) {
      setError("请输入包源，例如 npm:@foo/pi-tools");
      return;
    }
    setInstalling(true);
    setError(null);
    try {
      const res = (await request("plugin.install", { source: spec })) as { ok: boolean; error?: string };
      if (!res.ok) {
        setError(res.error ?? "安装失败");
        return;
      }
      setInstallText("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装失败");
    } finally {
      setInstalling(false);
    }
  };

  const uninstall = async (source: string): Promise<void> => {
    setBusySource(source);
    setError(null);
    try {
      const res = (await request("plugin.uninstall", { source })) as { ok: boolean; error?: string };
      if (!res.ok) {
        setError(res.error ?? "卸载失败");
        return;
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "卸载失败");
    } finally {
      setBusySource(null);
    }
  };

  const totalResources = packages.reduce(
    (acc, p) => {
      acc.extensions += p.resources.extensions;
      acc.skills += p.resources.skills;
      acc.prompts += p.resources.prompts;
      acc.themes += p.resources.themes;
      return acc;
    },
    { extensions: 0, skills: 0, prompts: 0, themes: 0 },
  );

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: t.color.bg,
        color: t.color.fg,
        overflow: "hidden",
        fontFamily: t.font.sans,
      }}
    >
      <style>{`
        .piweb-pkg * { box-sizing: border-box; }
        .piweb-pkg-back:focus-visible, .piweb-pkg-action:focus-visible, .piweb-pkg-install:focus-visible {
          outline: 3px solid rgba(129,140,248,0.4);
          outline-offset: 2px;
        }
        .piweb-pkg-action:active:not(:disabled) { transform: scale(0.97); }
        .piweb-pkg-action:disabled { cursor: wait !important; opacity: 0.6; }
        .piweb-pkg-spinner {
          width: 13px; height: 13px; flex-shrink: 0;
          border: 2px solid currentColor;
          border-right-color: transparent;
          border-radius: 50%;
          animation: piweb-pkg-spin 700ms linear infinite;
        }
        @keyframes piweb-pkg-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .piweb-pkg *, .piweb-pkg *::before, .piweb-pkg *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      {/* ── Top bar ── */}
      <header
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "0 18px",
          height: 54,
          borderBottom: `1px solid ${t.color.border}`,
          background: isDark ? "rgba(15,17,23,0.88)" : "rgba(255,255,255,0.9)",
          backdropFilter: "blur(12px)",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: BRAND_GRADIENT, opacity: 0.9, pointerEvents: "none" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="piweb-pkg-back"
            onClick={onClose}
            aria-label="返回上一页"
            style={{
              width: 40, height: 40, border: `1px solid ${t.color.border}`, borderRadius: 9,
              background: "transparent", color: t.color.muted, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              transition: "color 150ms ease, border-color 150ms ease, background 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#a5b4fc";
              e.currentTarget.style.borderColor = "rgba(129,140,248,0.5)";
              e.currentTarget.style.background = "rgba(129,140,248,0.09)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = t.color.muted;
              e.currentTarget.style.borderColor = t.color.border;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div style={{ fontSize: 14, fontWeight: 680, letterSpacing: "-0.01em", color: t.color.fg }}>Pi 包管理</div>
        </div>

        <div
          aria-live="polite"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 550, color: t.color.muted }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
            {packages.filter((p) => p.installed).length} 已安装
          </span>
          {totalResources.extensions > 0 && <span>· {totalResources.extensions} 扩展</span>}
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <main
        className="piweb-pkg-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "26px 32px 60px",
          scrollbarGutter: "stable",
          background: isDark
            ? "radial-gradient(1100px 380px at 50% -140px, rgba(99,102,241,0.14), transparent 72%)"
            : "radial-gradient(1100px 380px at 50% -140px, rgba(99,102,241,0.09), transparent 72%)",
        }}
      >
        <div style={{ width: "100%", maxWidth: 980, margin: "0 auto" }}>
          {/* ── Heading ── */}
          <div style={{ marginBottom: 22, textAlign: "center" }}>
            <h1
              style={{
                margin: 0, fontSize: 28, lineHeight: 1.15, fontWeight: 760,
                letterSpacing: "-0.025em",
                background: BRAND_GRADIENT, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
              }}
            >
              Pi 包管理
            </h1>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 8, marginTop: 9, fontSize: 12.5, color: t.color.muted }}>
              <span>与 pi CLI 完全互通 —— 这里安装的包，</span>
              <code style={{ fontFamily: t.font.mono, fontSize: 11.5, color: t.color.fg, background: t.color.surface, padding: "1px 6px", borderRadius: 5 }}>pi list</code>
              <span>同样可见，反之亦然</span>
            </div>
          </div>

          {/* ── Install bar ── */}
          <div
            style={{
              display: "flex",
              gap: 9,
              marginBottom: 22,
              padding: 14,
              borderRadius: 14,
              background: isDark ? "rgba(129,140,248,0.06)" : "rgba(99,102,241,0.05)",
              border: `1px solid ${isDark ? "rgba(129,140,248,0.18)" : "rgba(99,102,241,0.16)"}`,
            }}
          >
            <input
              className="piweb-pkg-install"
              value={installText}
              onChange={(e) => setInstallText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void install(installText);
              }}
              placeholder="输入包源安装，例如 npm:@foo/pi-tools"
              aria-label="Pi 包源"
              style={{
                flex: 1,
                minWidth: 0,
                height: 40,
                borderRadius: 9,
                border: `1px solid ${t.color.border}`,
                background: isDark ? "rgba(0,0,0,0.25)" : "#ffffff",
                padding: "0 13px",
                fontSize: 13,
                fontFamily: t.font.mono,
                color: t.color.fg,
                outline: "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(129,140,248,0.6)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = t.color.border;
              }}
            />
            <button
              className="piweb-pkg-action"
              onClick={() => void install(installText)}
              disabled={installing}
              style={{
                height: 40,
                padding: "0 20px",
                borderRadius: 9,
                border: "none",
                background: BRAND_GRADIENT,
                color: "#fff",
                fontSize: 13,
                fontWeight: 650,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                boxShadow: "0 4px 12px rgba(99,102,241,0.24)",
              }}
            >
              {installing && <span className="piweb-pkg-spinner" />}
              {installing ? "安装中" : "安装"}
            </button>
          </div>

          {/* Source examples */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 11.5, color: t.color.muted, flexWrap: "wrap" }}>
            <span>支持：</span>
            {INSTALL_EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setInstallText(ex)}
                style={{
                  fontFamily: t.font.mono,
                  fontSize: 11,
                  color: "#a5b4fc",
                  background: "rgba(129,140,248,0.09)",
                  border: `1px solid ${isDark ? "rgba(129,140,248,0.22)" : "rgba(99,102,241,0.18)"}`,
                  borderRadius: 999,
                  padding: "3px 9px",
                  cursor: "pointer",
                }}
              >
                {ex}
              </button>
            ))}
            <span aria-hidden="true" style={{ color: t.color.border }}>·</span>
            <span>
              <a href="https://pi.dev/packages" target="_blank" rel="noreferrer" style={{ color: "#a5b4fc", textDecoration: "none" }}>
                浏览 pi.dev/packages ↗
              </a>
            </span>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                display: "flex", alignItems: "flex-start", gap: 9,
                fontSize: 12.5, lineHeight: 1.55,
                color: t.color.error,
                background: isDark ? "rgba(248,81,73,0.09)" : "rgba(220,38,38,0.05)",
                border: `1px solid ${isDark ? "rgba(248,81,73,0.24)" : "rgba(220,38,38,0.18)"}`,
                borderRadius: 11, padding: "10px 13px", marginBottom: 18,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginTop: 1, flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 17h.01" /></svg>
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 11, padding: "40px 0", color: t.color.muted, fontSize: 13 }}>
              <span className="piweb-pkg-spinner" />
              正在读取已安装的包…
            </div>
          )}

          {!loading && packages.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 220, color: t.color.muted }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#a5b4fc", background: "rgba(129,140,248,0.1)", marginBottom: 12, fontSize: 18 }}>📦</div>
              <div style={{ color: t.color.fg, fontSize: 14, fontWeight: 650 }}>还没有安装任何 pi 包</div>
              <div style={{ marginTop: 5, fontSize: 12.5, textAlign: "center" }}>
                在上面输入 <code style={{ fontFamily: t.font.mono, fontSize: 11.5, color: t.color.fg }}>npm:@包名</code> 安装，或到
                {" "}<a href="https://pi.dev/packages" target="_blank" rel="noreferrer" style={{ color: "#a5b4fc" }}>pi.dev/packages</a>{" "}
                浏览生态。
              </div>
            </div>
          )}

          {/* ── Installed packages ── */}
          {!loading && packages.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {packages.map((pkg) => {
                const isHovered = hoveredSource === pkg.source;
                const isBusy = busySource === pkg.source;
                return (
                  <article
                    key={pkg.source}
                    className="piweb-pkg-row"
                    onMouseEnter={() => setHoveredSource(pkg.source)}
                    onMouseLeave={() => setHoveredSource(null)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 13,
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: `1px solid ${t.color.border}`,
                      background: isHovered ? (isDark ? "rgba(129,140,248,0.07)" : "rgba(99,102,241,0.04)") : "transparent",
                      borderLeft: isHovered ? `3px solid #818cf8` : "3px solid transparent",
                      paddingLeft: isHovered ? 11 : 14,
                      transition: "background 140ms ease, border-left-color 140ms ease, padding-left 140ms ease",
                      opacity: isBusy ? 0.6 : 1,
                    }}
                  >
                    {/* Icon chip */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: "rgba(129,140,248,0.1)",
                      color: "#a5b4fc",
                      border: "1px solid rgba(129,140,248,0.22)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 7a4 4 0 1 1 3 6.9c-.8-.4-1.3-1.2-1.3-2.1V9h-2.8A2.8 2.8 0 0 1 10 6.2c0-.8.3-1.5.8-2.1A4 4 0 0 1 14 7z" /><path d="M4 14a4 4 0 0 0 6.9 3A4 4 0 0 0 5 12.7h2.8V10A2.8 2.8 0 0 1 11.8 8c.8 0 1.5.3 2.1.8a4 4 0 0 0-3 6.9V14H7.6z" /></svg>
                    </div>

                    {/* Body */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <code style={{ fontSize: 12.5, fontWeight: 650, color: t.color.fg, fontFamily: t.font.mono }}>
                          {pkg.source}
                        </code>
                        <span style={{
                          fontSize: 10, fontWeight: 650, letterSpacing: "0.02em",
                          color: pkg.scope === "user" ? "#a5b4fc" : t.color.muted,
                          background: pkg.scope === "user" ? "rgba(129,140,248,0.1)" : "transparent",
                          border: `1px solid ${pkg.scope === "user" ? "rgba(129,140,248,0.25)" : t.color.border}`,
                          borderRadius: 999, padding: "2px 7px",
                        }}>
                          {pkg.scope === "user" ? "全局" : "项目"}
                        </span>
                        {pkg.installed ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 650, color: "#3fb950", background: "rgba(63,185,80,0.09)", border: "1px solid rgba(63,185,80,0.16)", borderRadius: 999, padding: "2.5px 7px" }}>
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                            已安装
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 650, color: t.color.warning, background: "rgba(210,153,34,0.09)", border: "1px solid rgba(210,153,34,0.18)", borderRadius: 999, padding: "2.5px 7px" }}>
                            未安装
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 7, marginTop: 4, fontSize: 11, color: t.color.muted }}>
                        <span>{resourceLabel(pkg)}</span>
                        {pkg.installedPath && (
                          <>
                            <span aria-hidden="true" style={{ color: t.color.border }}>·</span>
                            <code style={{ fontFamily: t.font.mono, fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>
                              {pkg.installedPath}
                            </code>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        className="piweb-pkg-action"
                        onClick={() => void uninstall(pkg.source)}
                        disabled={isBusy}
                        aria-label={`卸载 ${pkg.source}`}
                        style={{
                          minHeight: 34,
                          borderRadius: 8,
                          padding: "0 13px",
                          fontSize: 12,
                          cursor: "pointer",
                          fontWeight: 600,
                          border: `1px solid ${t.color.border}`,
                          background: "transparent",
                          color: t.color.fg,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                        onMouseEnter={(e) => {
                          if (isBusy) return;
                          e.currentTarget.style.borderColor = t.color.error;
                          e.currentTarget.style.color = t.color.error;
                          e.currentTarget.style.background = isDark ? "rgba(248,81,73,0.06)" : "rgba(220,38,38,0.04)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = t.color.border;
                          e.currentTarget.style.color = t.color.fg;
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {isBusy && <span className="piweb-pkg-spinner" />}
                        {isBusy ? "卸载中" : "卸载"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* footer note */}
          <div style={{ marginTop: 26, fontSize: 11.5, lineHeight: 1.7, color: t.color.muted, textAlign: "center" }}>
            在 pi TUI 中用 <code style={{ fontFamily: t.font.mono, fontSize: 11, color: t.color.fg }}>pi install npm:&lt;包名&gt;</code> 安装的包同样出现在这里。
            <br />
            卸载请到 TUI 使用 <code style={{ fontFamily: t.font.mono, fontSize: 11, color: t.color.fg }}>pi remove</code>，或在这里点击"卸载"。
          </div>
        </div>
      </main>
    </div>
  );
}
