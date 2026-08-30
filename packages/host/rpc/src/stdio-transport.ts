import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { Frame as FrameSchema } from "@vagus/protocol";
import type { Frame } from "@vagus/protocol";

/**
 * Host-side stdio JSONL transport (ADR-003).
 *
 * One JSON frame per line on stdin/stdout. Lines are LF-delimited only —
 * consumers must not use generic Unicode line readers (the same caveat pi's
 * RPC mode documents). Malformed frames are dropped with a stderr diagnostic
 * instead of crashing the daemon.
 */

/** Hard cap per line to bound memory on hostile/broken input (1 MiB). */
const MAX_LINE_BYTES = 1024 * 1024;

export interface StdioStreams {
  stdin: Readable;
  stdout: Writable;
}

export class StdioTransport {
  private readline?: ReturnType<typeof createInterface>;
  private closed = false;

  constructor(
    private readonly onFrame: (frame: Frame) => void,
    private readonly streams: StdioStreams = { stdin: process.stdin, stdout: process.stdout },
  ) {}

  /** Starts reading frames from stdin. */
  start(): void {
    if (this.closed) return;
    this.readline = createInterface({ input: this.streams.stdin, crlfDelay: Infinity });
    this.readline.on("line", (line: string) => this.handleLine(line));
  }

  /** Writes a frame to stdout as a single JSON line. */
  send(frame: Frame): void {
    if (this.closed) return;
    this.streams.stdout.write(`${JSON.stringify(frame)}\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readline?.close();
  }

  private handleLine(line: string): void {
    if (line.length > MAX_LINE_BYTES) {
      process.stderr.write(`vagus: dropping oversized frame (${line.length} bytes)\n`);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      process.stderr.write("vagus: dropping malformed frame (invalid JSON)\n");
      return;
    }
    const frame = FrameSchema.safeParse(parsed);
    if (!frame.success) {
      process.stderr.write("vagus: dropping malformed frame (schema mismatch)\n");
      return;
    }
    this.onFrame(frame.data);
  }
}
