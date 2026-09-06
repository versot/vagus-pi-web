/**
 * Minimal i18n — Chinese source strings ARE the keys. `t("新对话")` looks the
 * text up in the active locale's dictionary (en.json); a missing entry falls
 * back to the source string itself, so untranslated text still renders as
 * Chinese and adding a language never requires touching component code.
 *
 * Locale is persisted in localStorage. React reactivity comes from
 * `I18nProvider`/`useI18n()` in @vagus/ui-tokens — components that render
 * translated text use the hook; plain (non-React) modules may call `t()`
 * directly (they pick up the locale on their next invocation).
 */

export type Locale = "zh" | "en";

export const DEFAULT_LOCALE: Locale = "zh";
export const LOCALES: Locale[] = ["zh", "en"];

const STORAGE_KEY = "vagus.i18n.locale";

let currentLocale: Locale = DEFAULT_LOCALE;

/** Registered dictionaries per locale (zh is the source language — none needed). */
const dictionaries = new Map<Locale, Record<string, string>>();

export function registerLocale(locale: Locale, dict: Record<string, string>): void {
  dictionaries.set(locale, dict);
}

export function getLocale(): Locale {
  return currentLocale;
}

export function loadLocalePreference(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "en" || raw === "zh") currentLocale = raw;
  } catch { /* private mode — keep default */ }
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch { /* private mode — session-only */ }
}

/** Interpolates `{name}` placeholders from `params`. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in params ? String(params[key]) : m,
  );
}

/**
 * Translates `text` (a Chinese source string) into the active locale, with
 * `{placeholder}` interpolation. Unknown keys fall back to the source text.
 */
export function t(text: string, params?: Record<string, string | number>): string {
  if (currentLocale === "zh") return interpolate(text, params);
  const dict = dictionaries.get(currentLocale);
  const translated = dict?.[text];
  return interpolate(translated ?? text, params);
}

/** Alias of {@link t} — avoids clashing with `const t = useTokens()` in components. */
export const tr = t;
