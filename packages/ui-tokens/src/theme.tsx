import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { lightTokens, tokens } from "@vagus/ui-shared";
import type { TokensReadonly } from "@vagus/ui-shared";

/**
 * GUI theme context — light/dark/system-preference support.
 *
 * The design tokens live in @vagus/ui-shared (both themes shipped together so
 * a rebrand touches one file). This provider resolves the active token set
 * from the user's preference (`light` | `dark` | `system`), persists the
 * choice in localStorage, and flips a `data-theme` attribute so any CSS that
 * needs it (scrollbars, focus rings) follows the same theme.
 *
 * NOTE: This is intentionally identical to the original Vagus theme system —
 * the web GUI keeps its own appearance. Model/config interop with pi lives in
 * the daemon (models.json, packages, mcp.json); the UI look stays Vagus.
 */

export type Theme = "light" | "dark";
/** User-facing theme preference; `system` resolves to the OS setting. */
export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "vagus.theme.v2";

interface ThemeContextValue {
  /** The resolved theme actually in effect (`system` preference already applied). */
  theme: Theme;
  /** The user's stored preference (light | dark | system). */
  preference: ThemePreference;
  /** The active token set (components consume via `useTokens()`). */
  tokens: TokensReadonly;
  /** Sets the theme preference. */
  setPreference: (pref: ThemePreference) => void;
  /** Toggles between light and dark (from system, falls back to light). */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true
  );
}

function initialPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  // Default light for consistent cross-browser appearance (prefers-color-scheme
  // differs between Chrome and Edge, which would give one a dark theme unasked).
  return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  const theme: Theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preference);
    document.documentElement.setAttribute("data-theme", theme);
  }, [preference, theme]);

  // Follow OS changes while in system mode.
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      preference,
      tokens: theme === "light" ? lightTokens : tokens,
      setPreference: setPreferenceState,
      toggleTheme: () => setPreferenceState((p) => (p === "light" ? "dark" : "light")),
    }),
    [theme, preference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Full theme context: resolved theme, stored preference, and controls.
 * Used by components that need to read or change the preference
 * (e.g. the appearance settings panel). Falls back to dark when no provider
 * is mounted so components never crash standalone.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      theme: "dark",
      preference: "dark",
      tokens,
      setPreference: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}

export function useTokens(): TokensReadonly {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback: dark theme (matches TUI) so components never crash standalone.
    return tokens;
  }
  return ctx.tokens;
}
