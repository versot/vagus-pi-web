import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GUI dev server. Production serves this SPA from the daemon (M4); the
 * WebSocket protocol endpoint lives at `/vagus-rpc` on the same origin.
 */
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Function-form manualChunks: keep react/react-dom in a stable vendor
        // chunk AND force the lazily-loaded settings/plugins panels into their
        // own chunk so the initial load never carries them.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "vendor";
          }
          if (id.includes("@vagus/ui-settings") || id.includes("/ui-settings/")) {
            return "settings";
          }
        },
      },
    },
  },
  plugins: [
    react(),
    {
      name: "no-preload-settings",
      // Vite auto-injects modulepreload for dynamically-imported chunks,
      // which would fetch the settings panel on first paint — defeating the
      // lazy() split. Strip its preload link; the panel loads on demand.
      transformIndexHtml(html) {
        return html.replace(
          /<link rel="modulepreload"[^>]*href="[^"]*settings-[^"]*\.js"[^>]*>\s*/g,
          "",
        );
      },
    },
  ],
});
