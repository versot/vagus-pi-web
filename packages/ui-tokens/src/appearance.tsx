import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

/**
 * Appearance settings context — interface/code font sizes and code display
 * preferences. Persisted to localStorage so the choice survives reloads;
 * the daemon's `config.set` RPC can adopt the same values later.
 *
 * The theme preference itself lives in the {@link ThemeProvider}; this
 * context only covers appearance values that are display settings.
 */

export interface AppearanceSettings {
  /** Base UI font size in px (chat text inherits via `em`). */
  uiFontSize: number;
  /** Show line numbers in fenced code blocks. */
  showLineNumbers: boolean;
  /** Wrap long lines in code blocks instead of horizontal scroll. */
  wrapLongLines: boolean;
  /** Code block font size in px (independent of the UI font size). */
  codeFontSize: number;
}

const STORAGE_KEY = "vagus.appearance.v1";

const DEFAULTS: AppearanceSettings = {
  uiFontSize: 14,
  showLineNumbers: true,
  wrapLongLines: true,
  codeFontSize: 12,
};

interface AppearanceContextValue extends AppearanceSettings {
  /** Merges a partial patch into the current settings. */
  update: (patch: Partial<AppearanceSettings>) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined);

function loadSettings(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    return {
      uiFontSize: typeof parsed.uiFontSize === "number" ? parsed.uiFontSize : DEFAULTS.uiFontSize,
      showLineNumbers: typeof parsed.showLineNumbers === "boolean" ? parsed.showLineNumbers : DEFAULTS.showLineNumbers,
      wrapLongLines: typeof parsed.wrapLongLines === "boolean" ? parsed.wrapLongLines : DEFAULTS.wrapLongLines,
      codeFontSize: typeof parsed.codeFontSize === "number" ? parsed.codeFontSize : DEFAULTS.codeFontSize,
    };
  } catch {
    return DEFAULTS;
  }
}

export function AppearanceProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<AppearanceSettings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      ...settings,
      update: (patch) => setSettings((s) => ({ ...s, ...patch })),
    }),
    [settings],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/** Reads/updates appearance settings. Falls back to defaults when no provider is mounted. */
export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) return { ...DEFAULTS, update: () => {} };
  return ctx;
}
