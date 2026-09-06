import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.shared.js";

/**
 * Unit test configuration. Tests import workspace packages from source
 * (via aliases) so `pnpm test` works without a prior build step.
 */
export default defineConfig({
  resolve: workspaceAliases,
  test: {
    include: ["packages/**/*.test.ts"],
    // Unit tests talk to localhost servers only — a dev machine's proxy env
    // (read by Node 24+ fetch/WS at worker startup) would hijack the
    // connections. Strip before any worker runs.
    env: {
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      NO_PROXY: "*",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
