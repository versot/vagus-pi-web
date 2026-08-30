#!/usr/bin/env node
/**
 * Builds the npx-publishable `@versot/vaguspi` package.
 *
 * `npx @versot/vaguspi web` must work with zero repo dependencies, so this
 * assembles a self-contained package:
 *
 *   packages/pi-web/
 *   ├── package.json        # name @versot/vaguspi, bin: pi-web
 *   ├── dist/
 *   │   ├── bin.js          # CLI bundle (all workspace deps inlined)
 *   │   └── gui/            # web UI static assets
 *   └── extensions/
 *       └── mcp-extension.js     # built-in MCP extension
 *
 * The pi SDK packages stay EXTERNAL (declared as dependencies) — they are
 * large and installed by npm when the package is fetched via npx.
 */

import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dirname, "..");
const repoRoot = join(pkgDir, "..", "..");

// esbuild lives in the monorepo's .pnpm store (packages/pi-web is standalone
// and not in the workspace) — resolve it from the repo root store.
const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
const esbuildEntry = readdirSync(pnpmDir).find((d) => d.startsWith("esbuild@"));
if (!esbuildEntry) {
  console.error("npx-bundle: esbuild not found in monorepo .pnpm store — run `pnpm install` at repo root.");
  process.exit(1);
}
const require = createRequire(join(pnpmDir, esbuildEntry, "node_modules", "esbuild", "package.json"));
const { build } = require("esbuild");

/** pi SDK + friends: installed as dependencies, NOT bundled. */
const EXTERNAL = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-client",
  "@earendil-works/pi-protocol",
  "@earendil-works/pi-telemetry",
  "@earendil-works/pi-tui",
  "typebox",
  "@modelcontextprotocol/*",
  // CJS deps with dynamic require() that break under esbuild ESM bundling —
  // keep them external and install as dependencies instead.
  "ws",
  "diff",
  "undici",
];

async function bundleCli() {
  await build({
    entryPoints: [join(repoRoot, "apps", "cli", "src", "bin.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: join(pkgDir, "dist", "bin.js"),
    external: EXTERNAL,
    sourcemap: true,
    logLevel: "warning",
  });
  console.log("npx-bundle: CLI bundled → dist/bin.js");
}

function copyFiles() {
  // GUI assets (at {pkg}/gui/ so the bundled web.ts guiDistPath() →
  // `new URL("../gui", import.meta.url)` resolves correctly)
  const guiSrc = join(repoRoot, "apps", "gui", "dist");
  // Clean dest dirs before copying to avoid stale file accumulation.
  const guiDest = join(pkgDir, "gui");
  if (existsSync(guiDest)) rmSync(guiDest, { recursive: true, force: true });
  mkdirSync(guiDest, { recursive: true });
  cpSync(guiSrc, guiDest, { recursive: true, force: true });
  console.log("npx-bundle: GUI assets → dist/gui/");

  // MCP extension (already built by @vagus/pi-web-mcp)
  const mcpSrc = join(repoRoot, "packages", "mcp-extension", "dist", "index.js");
  if (!existsSync(mcpSrc)) {
    console.error("npx-bundle: mcp-extension dist missing — run `pnpm --filter @vagus/pi-web-mcp build` first.");
    process.exit(1);
  }
  // Clean + copy MCP extension
  const extDir = join(pkgDir, "extensions");
  if (existsSync(extDir)) rmSync(extDir, { recursive: true, force: true });
  mkdirSync(extDir, { recursive: true });
  cpSync(mcpSrc, join(pkgDir, "extensions", "mcp-extension.js"), { force: true });
  console.log("npx-bundle: mcp-extension → extensions/mcp-extension.js");

  // LICENSE
  const license = join(repoRoot, "LICENSE");
  if (existsSync(license)) cpSync(license, join(pkgDir, "LICENSE"), { force: true });
}

await bundleCli();
copyFiles();
console.log("npx-bundle: assembly complete → `cd packages/pi-web && npm publish`");
