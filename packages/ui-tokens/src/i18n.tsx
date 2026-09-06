import React, { createContext, useContext, useMemo, useState } from "react";
import { getLocale, loadLocalePreference, setLocale as persistLocale, type Locale } from "@vagus/ui-shared";

/**
 * Locale context — wraps the i18n module state in React so a language
 * switch re-renders the whole tree. The module-level `t()` stays usable
 * from non-React code; this provider exists purely for reactivity.
 */

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(() => loadLocalePreference());

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        persistLocale(next);
        setLocaleState(next);
      },
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Current locale + setter. Falls back to the module default when no provider is mounted. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) return { locale: getLocale(), setLocale: persistLocale };
  return ctx;
}
