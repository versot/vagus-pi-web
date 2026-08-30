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
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
