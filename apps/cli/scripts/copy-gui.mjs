#!/usr/bin/env node
/**
 * Copies the built GUI dist into the CLI package so `pi-web web` can serve it.
 *
 * Called from `pnpm build:with-gui` (or `pnpm build:web` at root).
 * Expects `apps/gui/dist/` to exist (pre-built by `pnpm --filter @vagus/pi-web-gui build`).
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const cliDir = join(import.meta.dirname, "..");
const guiDist = join(cliDir, "..", "gui", "dist");
const target = join(cliDir, "dist", "gui");

if (!existsSync(guiDist)) {
  console.error("pi-web: GUI dist not found — run `pnpm --filter @vagus/pi-web-gui build` first.");
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
cpSync(guiDist, target, { recursive: true, force: true });
console.log(`pi-web: GUI assets copied to ${target}`);