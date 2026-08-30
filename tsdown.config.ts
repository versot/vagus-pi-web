import { defineConfig } from "tsdown";

/**
 * Root bundling configuration (mirrors the DeepSeek Harness approach of a
 * single tsdown config at the workspace root). Each entry maps to a package's
 * public entry point; dts is emitted via `tsc -b` (project references).
 *
 * pi SDK packages are marked external — they are large, contain side-effect
 * JSON data files, and should be installed as runtime dependencies, not
 * bundled into the published output.
 */
export default defineConfig({
  entry: [
    "packages/protocol/src/index.ts",
    "packages/host/events/src/index.ts",
    "packages/host/config/src/index.ts",
    "packages/host/models/src/index.ts",
    "packages/host/engine/src/index.ts",
    "packages/host/rpc/src/index.ts",
    "packages/ui-shared/src/index.ts",
  ],
  format: ["esm"],
  target: "node22",
  sourcemap: true,
  clean: true,
  // Root tsconfig.json is a solution file (files: [] + references), so the
  // dts plugin must run `tsc -b` to build referenced projects before it can
  // load the entries. This also covers ui-shared, which is a client package
  // not included in tsconfig.host.json.
  dts: {
    build: true,
  },
  external: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
  ],
});