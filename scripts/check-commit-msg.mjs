#!/usr/bin/env node
/**
 * Conventional-commit check, wired into lefthook's commit-msg hook.
 * Accepts the Angular conventional format, e.g.:
 *   fix(core): resolve event ordering
 *   docs: add adapter spec
 *
 * Git passes the commit message FILE path as argv[2]; the script reads it,
 * extracts the first line (subject), and validates it. When called directly
 * with a string (e.g., manual testing), the raw string is used.
 */
import { readFileSync, existsSync } from "node:fs";

const raw = process.argv[2] ?? "";
const message = existsSync(raw) ? readFileSync(raw, "utf8") : raw;
const subject = message.split("\n")[0] ?? "";

// Skip merge commits and generated messages.
if (/^(Merge|Revert|release)/i.test(subject)) {
  process.exit(0);
}

const pattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?: .{1,100}$/;
if (!pattern.test(subject)) {
  process.stderr.write(
    `invalid commit message:\n  "${subject}"\n` +
      "expected format: <type>(<scope>): <subject>\n" +
      "types: feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert\n",
  );
  process.exit(1);
}
