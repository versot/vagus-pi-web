/**
 * `pnpm check:all` — the single gate command for local dev and CI.
 *
 * Mirrors the gating idea of DeepSeek Harness (run-gates.ts) in a deliberately
 * small form: gates run sequentially, fail fast, and print a summary. The gate
 * list below is the M0 contract; coverage enforcement lands with the snapshot
 * suite (see docs/ARCHITECTURE.md §6).
 */

import { spawnSync } from "node:child_process";

interface Gate {
  name: string;
  command: string[];
}

const GATES: Gate[] = [
  { name: "lint", command: ["pnpm", "lint"] },
  { name: "typecheck", command: ["pnpm", "typecheck"] },
  { name: "unit tests", command: ["pnpm", "test"] },
  { name: "knip (dead code)", command: ["pnpm", "knip"] },
  { name: "jscpd (duplication)", command: ["pnpm", "duplication"] },
];

function runGate(gate: Gate): boolean {
  process.stdout.write(`\n▶ gate: ${gate.name}\n`);
  const [command, ...args] = gate.command;
  if (!command) return false;
  // Commands are fixed literals from GATES below (never user input), so
  // joining into a single shell string is safe on every platform and avoids
  // the DEP0190 warning that `shell: true` + args arrays produce on Windows.
  const result = spawnSync([command, ...args].join(" "), {
    stdio: "inherit",
    shell: true,
  });
  return result.status === 0;
}

function main(): void {
  process.stdout.write("vagusPI check:all — running quality gates\n");
  const results: Array<{ name: string; ok: boolean }> = [];

  for (const gate of GATES) {
    const ok = runGate(gate);
    results.push({ name: gate.name, ok });
    if (!ok) {
      process.stderr.write(`✗ gate failed: ${gate.name}\n`);
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write("\ncheck:all summary\n");
  for (const { name, ok } of results) {
    process.stdout.write(`  ${ok ? "✓" : "✗"} ${name}\n`);
  }
  process.stdout.write("all gates passed\n");
}

main();
