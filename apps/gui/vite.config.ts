import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GUI dev server. Production serves this SPA from the daemon (M4); the
 * WebSocket protocol endpoint lives at `/vagus-rpc` on the same origin.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
        },
      },
    },
  },
});
