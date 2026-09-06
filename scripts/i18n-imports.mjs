#!/usr/bin/env node
/**
 * Adds the `t` import to every .tsx file that now references t( but does not
 * import it yet. Uses the existing @vagus/ui-shared import when present,
 * otherwise appends a new import line.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_DIRS = [
  "packages/ui-sidebar/src",
  "packages/ui-chat/src",
  "packages/ui-panes/src",
  "packages/ui-input/src",
  "packages/ui-settings/src",
  "packages/web/src",
];

function walk(dir, out = []) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (f.name.endsWith(".tsx") || f.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

for (const dir of TARGET_DIRS) {
  for (const file of walk(join(root, dir))) {
    let src = readFileSync(file, "utf8");
    // References t( but doesn't import it, and doesn't define a local t
    const usesT = /\btr\(/.test(src);
    const importsT = /import\s*\{[^}]*\btr\b[^}]*\}\s*from/.test(src);
    const localT = /(const|function)\s+t\s*[=(]/.test(src) || /, t\b|t,/.test(src) && /t: ReturnType/.test(src);
    if (!usesT || importsT || /const tk = useTokens/.test(src)) {
      // files with `const tk = useTokens()` shadow t — rename those to tokens
      if (usesT && /const tk = useTokens\(\)/.test(src)) {
        // t is used as both tokens object AND our translate fn → conflict.
        // Rename the tokens variable to `tk` throughout this file.
        let s = src.replace(/const tk = useTokens\(\);/, "const tk = useTokens();");
        s = s.replace(/\bt\.color\b/g, "tk.color");
        s = s.replace(/\bt\.fontSize\b/g, "tk.fontSize");
        s = s.replace(/\bt\.font\b/g, "tk.font");
        s = s.replace(/t: ReturnType<typeof useTokens>/g, "tk: ReturnType<typeof useTokens>");
        // props destructures: { ..., t }: { ..., t: ... }
        s = s.replace(/([{,]\s*)t(\s*[,}])/g, "$1tk$2");
        // add i18n import
        if (!/import\s*\{[^}]*\btr\b[^}]*\}\s*from\s*"@vagus\/ui-shared"/.test(s)) {
          s = s.replace(/(import[^;]*from "@vagus\/ui-shared";)/, `$1\nimport { tr } from "@vagus/ui-shared";`);
          if (!/from "@vagus\/ui-shared"/.test(s)) {
            s = `import { tr } from "@vagus/ui-shared";\n` + s;
          }
        }
        writeFileSync(file, s);
        console.log("RENAMED tokens→tk + import:", file.replace(root + "/", ""));
        continue;
      }
      if (!usesT || importsT) continue;
    }
    // Simple case: needs import, no shadowing
    let s = src;
    if (/from "@vagus\/ui-shared"/.test(s)) {
      s = s.replace(/(import \{)([^}]*)(\} from "@vagus\/ui-shared";)/, (m, a, names, b) => `${a}${names.trim() ? names.trim() + ", " : ""}t${b}`);
    } else {
      const firstImport = s.match(/^import .*?;$/m);
      if (firstImport) s = s.replace(firstImport[0], `${firstImport[0]}\nimport { tr } from "@vagus/ui-shared";`);
      else s = `import { tr } from "@vagus/ui-shared";\n` + s;
    }
    writeFileSync(file, s);
    console.log("import added:", file.replace(root + "/", ""));
  }
}
