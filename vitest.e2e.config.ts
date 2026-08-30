import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.shared.js";

/**
 * End-to-end configuration. E2E tests exercise real process boundaries
 * (daemon spawn, PTY, WebSocket); they are gated separately in CI.
 */
export default defineConfig({
  resolve: workspaceAliases,
  test: {
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 30_000,
  },
});
