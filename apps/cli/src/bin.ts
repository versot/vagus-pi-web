import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runDaemon } from "./commands/daemon.js";
import { runWeb } from "./commands/web.js";

/**
 * pi-web CLI entry (`pi-web`).
 *
 * Minimal command surface: the web UI is the product, the daemon is its
 * backend. `pi-web web` starts the daemon and opens the browser — the whole
 * app in one command. The pi CLI's own extension mechanism covers plugins.
 */

const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

interface Command {
  name: string;
  summary: string;
  /** When the command becomes available (roadmap milestone). */
  milestone: string;
  run: (args: string[]) => Promise<number> | number;
}

const commands: Command[] = [
  {
    name: "daemon",
    summary: "Start the vagusPI orchestration daemon",
    milestone: "ready",
    run: () => runDaemon(),
  },
  {
    name: "web",
    summary: "Start the daemon and open the web UI in your browser",
    milestone: "ready",
    run: () => runWeb(),
  },
  {
    name: "gui",
    summary: "Alias for `web` (open the web UI)",
    milestone: "ready",
    run: () => runWeb(),
  },
];

function printUsage(): void {
  process.stdout.write(`pi-web — pi coding agent web GUI v${VERSION}\n\n`);
  process.stdout.write("usage: pi-web <command> [options]\n\ncommands:\n");
  for (const command of commands) {
    process.stdout.write(`  ${command.name.padEnd(9)} ${command.summary} (${command.milestone})\n`);
  }
  process.stdout.write("\noptions:\n  --version  print version\n  -h, --help print this help\n");
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    printUsage();
    return 0;
  }

  const name = positionals[0];
  const command = commands.find((candidate) => candidate.name === name);
  if (!command) {
    process.stderr.write(`unknown command: ${name}\n\n`);
    printUsage();
    return 1;
  }
  return command.run(positionals.slice(1));
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
