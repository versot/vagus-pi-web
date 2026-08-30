import { describe, expect, it, vi } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type { AgentSession, CreateAgentSessionOptions, CreateAgentSessionResult } from "@earendil-works/pi-coding-agent";
import { EventBus } from "@vagus/host-events";
import type { CoreEventMap } from "@vagus/host-events";
import { VagusEngine, type VagusEngineOptions } from "../src/vagus-engine.js";

/** A minimal fake AgentSession compatible with pi's surface. */
function fakeSession(sessionId: string): AgentSession {
  return {
    sessionId,
    prompt: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    subscribe: () => () => {},
  } as unknown as AgentSession;
}

interface FakeFactory {
  factory: (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;
  calls: CreateAgentSessionOptions[];
  session: AgentSession;
}

/** A session factory returning the same fake session every time. */
function fakeFactory(sessionId = "fake-1"): FakeFactory {
  const calls: CreateAgentSessionOptions[] = [];
  const session = fakeSession(sessionId);
  const factory = async (options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult> => {
    calls.push(options);
    return {
      session,
      extensionsResult: {} as CreateAgentSessionResult["extensionsResult"],
    };
  };
  return { factory, calls, session };
}

function makeHost(factory = fakeFactory().factory) {
  const bus = new EventBus<CoreEventMap>();
  // A runtime with no models and no auth — `ensureConfiguredModel` skips
  // reachability probing entirely, so tests never touch the network.
  const modelRuntime = {
    hasConfiguredAuth: () => false,
    getAvailable: async () => [],
    getModel: () => undefined,
  } as unknown as VagusEngineOptions["modelRuntime"];
  const host = new VagusEngine({ cwd: "/repo", bus, sessionFactory: factory, modelRuntime });
  return { bus, host };
}

describe("VagusEngine", () => {
  it("creates a pi session and emits session.created", async () => {
    const { bus, host } = makeHost();
    const created = vi.fn();
    bus.subscribe("session.created", created);

    const ref = await host.createSession("/repo");

    expect(ref.sessionId).toBe("fake-1");
    expect(created).toHaveBeenCalledWith({
      type: "session.created",
      sessionId: "fake-1",
      cwd: "/repo",
    });
    await host.close();
  });

  it("forwards prompts to the active session", async () => {
    const f = fakeFactory();
    const { host } = makeHost(f.factory);

    await host.createSession("/repo");
    await host.prompt("fake-1", "hello");

    expect(f.session.prompt).toHaveBeenCalledWith("hello", expect.objectContaining({ streamingBehavior: "steer" }));
    await host.close();
  });

  it("keeps multiple sessions alive (multi-session model), disposing all on close", async () => {
    const f = fakeFactory();
    const { bus, host } = makeHost(f.factory);
    const closed = vi.fn();
    bus.subscribe("session.closed", closed);

    await host.createSession("/a");
    await host.createSession("/b");

    // Multi-session model: switching chats must NOT close the previous
    // session — each session's agent keeps running in the background until
    // the daemon shuts down (see startSession's doc comment).
    expect(f.session.dispose).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();

    await host.close();
    // close() disposes every live session and emits session.closed per session.
    expect(f.session.dispose).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith({ type: "session.closed", sessionId: "fake-1" });
  });

  it("rejects prompts for unknown sessions", async () => {
    const { host } = makeHost();
    await expect(host.prompt("missing", "hello")).rejects.toThrow(/no active session/);
    await host.close();
  });

  it("resumes a session file by calling the factory with an opened SessionManager", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/pi-session.jsonl", import.meta.url));
    const { bus, host } = makeHost();
    const created = vi.fn();
    bus.subscribe("session.created", created);

    const ref = await host.resumeSession(fixture);

    expect(created).toHaveBeenCalled();
    // cwd is read from the session header (Windows normalizes /repo → D:\repo).
    expect(ref.cwd.length).toBeGreaterThan(0);
    expect(ref.sessionFile).toBe(fixture);
    await host.close();
  });

  it("reads a session file's conversation as message views", () => {
    const fixture = fileURLToPath(new URL("./fixtures/pi-session.jsonl", import.meta.url));
    const { host } = makeHost();

    const views = host.readSessionMessages(fixture);

    expect(views.map((v) => v.role)).toEqual(["user", "assistant", "assistant", "user"]);
    // First assistant has thinking + toolCall + text
    expect(views[1]?.text).toBe("running now");
    expect(views[1]?.thinking).toBe("let me think");
    expect(views[1]?.toolCalls).toHaveLength(1);
    expect(views[1]?.toolCalls?.[0]?.name).toBe("bash");
    expect(views[1]?.toolCalls?.[0]?.result).toBe("hi");
    // Second assistant has thinking + text (no tool call)
    expect(views[2]?.text).toBe("**hi** world");
    expect(views[2]?.thinking).toBe("all good");
    expect(views[2]?.toolCalls).toBeUndefined();

    host.close();
  });

  it("lists history, returning [] when the pi store is empty", async () => {
    const { host } = makeHost();

    // An empty temp dir has no session files — list falls back to [].
    const sessions = await host.listHistory("/nonexistent-dir-xyz");
    expect(sessions).toEqual([]);
    await host.close();
  });

  it("keeps pi's original identity in the system prompt (no rebrand patch)", async () => {
    // The old project patched pi's DEFAULT prompt to rebrand it as "Vagus"
    // (patches/@earendil-works__pi-coding-agent@0.84.2.patch). That patch is
    // dropped in pi-web — the product is "pi's web", so pi keeps its own
    // identity. Assert the stock prompt template is untouched.
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(join(process.cwd(), "node_modules/.pnpm/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js")).href,
    );
    const buildPrompt = (mod as { buildSystemPrompt: (o: { cwd: string }) => string }).buildSystemPrompt;
    const prompt = buildPrompt({ cwd: "/repo" });
    // pi identity preserved — NOT renamed to Vagus.
    expect(prompt).toContain("operating inside pi");
    expect(prompt).not.toContain("You are Vagus");
    // Dynamic parts still render.
    expect(prompt).toContain("Available tools:");
    expect(prompt).toContain("Guidelines:");
  });
});
