import { App } from "./App.js";
import { AppearanceProvider, I18nProvider, ThemeProvider, useI18n } from "@vagus/ui-tokens";
import { enDict, registerLocale } from "@vagus/ui-shared";

// Register dictionaries before first render — t()/tr() resolve synchronously.
registerLocale("en", enDict);

/**
 * Keyed subtree: `key={locale}` re-mounts the whole app on a language switch,
 * so every tr() call across all components (subscribed or not) re-reads the
 * new locale immediately. Trade-off (deliberate, standard for language
 * switches): view state like open panels resets — session data lives in
 * external stores and survives.
 */
export function AppRoot(): JSX.Element {
  return (
    <I18nProvider>
      <LocaleKeyed />
    </I18nProvider>
  );
}

function LocaleKeyed(): JSX.Element {
  const { locale } = useI18n();
  return (
    <ThemeProvider>
      <AppearanceProvider>
        <App key={locale} />
      </AppearanceProvider>
    </ThemeProvider>
  );
}

export { App } from "./App.js";
