/**
 * Design tokens shared by both frontends.
 *
 * Visual components cannot be shared between Ink (TUI) and DOM (GUI), but the
 * underlying values can. Keeping them here means a rebrand touches one file.
 */

export interface Tokens {
  color: {
    primary: string;
    bg: string;
    /** Sidebar background — one shade deeper than `bg` so the nav reads as a distinct pane. */
    sidebarBg: string;
    /** Sidebar row hover / current-project background. */
    sidebarHover: string;
    surface: string;
    fg: string;
    muted: string;
    border: string;
    success: string;
    warning: string;
    error: string;
    accent: string;
  };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: { sm: number; md: number; lg: number };
  font: { mono: string; sans: string };
}

export type TokensReadonly = Readonly<Tokens>;

/** Default dark theme (used by both TUI and GUI; GUI toggles via ThemeProvider). */
const darkTokens: Tokens = {
  color: {
    primary: "#4f8cff",
    bg: "#0f1117",
    sidebarBg: "#12141a",
    sidebarHover: "#1b1f2b",
    surface: "#161922",
    fg: "#e6e8ee",
    muted: "#8b90a0",
    border: "#2a2e3a",
    success: "#3fb950",
    warning: "#d29922",
    error: "#f85149",
    accent: "#79c0ff",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 4, md: 8, lg: 12 },
  font: {
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
};

/** Light theme — same brand hues, lighter backgrounds. */
export const lightTokens: Tokens = {
  color: {
    primary: "#2563eb",
    bg: "#ffffff",
    sidebarBg: "#f6f7f9",
    sidebarHover: "#eceef1",
    surface: "#f3f4f6",
    fg: "#1f2937",
    muted: "#6b7280",
    border: "#e5e7eb",
    success: "#16a34a",
    warning: "#ca8a04",
    error: "#dc2626",
    accent: "#3b82f6",
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 4, md: 8, lg: 12 },
  font: {
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
};

/** Active token set (defaults to dark for backward compat with TUI). */
export const tokens: TokensReadonly = darkTokens;