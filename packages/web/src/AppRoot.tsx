import { App } from "./App.js";
import { AppearanceProvider, ThemeProvider } from "@vagus/ui-tokens";

/**
 * The assembled application: theme + appearance providers around the app.
 * `apps/gui` just mounts this at #root.
 */
export function AppRoot(): JSX.Element {
  return (
    <ThemeProvider>
      <AppearanceProvider>
        <App />
      </AppearanceProvider>
    </ThemeProvider>
  );
}

export { App } from "./App.js";
