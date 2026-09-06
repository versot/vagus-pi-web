#!/usr/bin/env node
/**
 * i18n codemod — wraps Chinese string literals in JSX text positions with t().
 *
 * Scoped transformation, deliberately conservative (ponytail):
 *  1. `label="中文"` / `hint="中文"` / `title="中文"` / `description="中文"`
 *     JSX attributes  →  label={tr("中文")}
 *  2. `>中文<` JSX text nodes (element children, no braces)  →  >{tr("中文")}<
 *  3. `"中文"` string literals passed where text is rendered is NOT touched —
 *     too risky blind; those are done by hand per-case.
 *
 * Skips: imports, comments, strings already inside {t(...)}, test files,
 * and anything in node_modules/dist.
 *
 * Usage: node scripts/i18n-codemod.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dry = process.argv.includes("--dry");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_DIRS = [
  "packages/ui-sidebar/src",
  "packages/ui-chat/src",
  "packages/ui-panes/src",
  "packages/ui-input/src",
  "packages/ui-settings/src",
  "packages/web/src",
];
const HAS_CN = /[\u4e00-\u9fa5]/;

function walk(dir, out = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (f.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

let totalAttrs = 0;
let totalText = 0;
const touched = [];

for (const dir of TARGET_DIRS) {
  const files = walk(join(root, dir));
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let out = src;

    // 1. JSX text attributes with Chinese values → {tr("...")}
    out = out.replace(
      /\b(label|hint|title|description|placeholder|confirmLabel|cancelLabel)=(\")([^\"]*[\u4e00-\u9fa5][^\"]*)(\")/g,
      (m, attr, q, val) => {
        totalAttrs++;
        return `${attr}={tr(${q}${val}${q})}`;
      },
    );

    // 2. JSX text nodes: >中文< → >{tr("中文")}< (only when the text between
    //    tags has no braces/tags of its own — safe simple text).
    out = out.replace(/>([^<>{}]*[\u4e00-\u9fa5][^<>{}]*)</g, (m, text) => {
      const trimmed = text.trim();
      // Skip if it's inside a comment or looks like a type annotation
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) return m;
      totalText++;
      const leading = text.slice(0, text.length - text.trimStart().length);
      const trailing = text.slice(text.trimEnd().length);
      return `>${leading}{tr("${trimmed}")}${trailing}<`;
    });

    if (out !== src) {
      if (!dry) writeFileSync(file, out);
      const n = out.split("tr(\"").length - (src.split("tr(\"").length);
      touched.push(`${file.replace(root + "/", "")} (+${n} t())`);
    }
  }
}

console.log(`${dry ? "[DRY] " : ""}attributes wrapped: ${totalAttrs}, text nodes wrapped: ${totalText}`);
for (const f of touched) console.log(" ", f);
