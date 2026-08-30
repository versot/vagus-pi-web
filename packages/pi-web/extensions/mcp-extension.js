import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// ── Shared connection registry (module level) ───────────────────────────
const sharedClients = new Map();
const sharedToolCache = new Map();
const connecting = new Map();
/** Connection key: name, plus cwd when the server carries one (project scope). */
function serverKey(server) {
    return server.config.cwd ? `${server.name}@${server.config.cwd}` : server.name;
}
/** Names known to provide MCP tool registration in a pi session. */
const KNOWN_MCP_ADAPTER_HINTS = ["mcp-adapter", "pi-mcp", "mcp_server"];
/** Read { mcpServers: {...} } from a JSON file (missing/corrupt → {}). */
function readMcpFile(path) {
    try {
        const raw = JSON.parse(readFileSync(path, "utf8"));
        const servers = raw.mcpServers;
        return typeof servers === "object" && servers !== null
            ? servers
            : {};
    }
    catch {
        return {};
    }
}
/** Merge user + project MCP configs (project wins on name clashes). */
function loadServers(agentDir, cwd) {
    const user = readMcpFile(join(agentDir, "mcp.json"));
    const project = readMcpFile(join(cwd, ".mcp.json"));
    // Normalize: accept BOTH the flat `{ name: config }` shape AND the
    // Claude-style `{ "mcpServers": { name: config } }` wrapper. Other tools
    // (Claude Desktop, Cursor, …) write the wrapped form, so be lenient.
    const normalize = (raw) => {
        if (raw && typeof raw === "object" && "mcpServers" in raw) {
            const wrapped = raw.mcpServers;
            if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
                return wrapped;
            }
        }
        return raw;
    };
    const merged = { ...normalize(user), ...normalize(project) };
    return Object.entries(merged)
        .map(([name, cfg]) => ({
        name,
        config: (typeof cfg === "object" && cfg !== null ? cfg : {}),
    }))
        // Honor per-server `enabled: false` — those servers never connect, so
        // they cost zero context (the "unused MCP doesn't consume context" property).
        .filter((s) => s.config.enabled !== false);
}
/** Best-effort check for another extension that already provides MCP tools. */
function hasExistingMcpAdapter(pi) {
    try {
        const active = pi.getActiveTools();
        return active.some((tool) => KNOWN_MCP_ADAPTER_HINTS.some((hint) => tool.toLowerCase().includes(hint)));
    }
    catch {
        return false;
    }
}
/** Convert an MCP JSON Schema to a TypeBox schema. Falls back to Type.Any(). */
function toTypeBoxSchema(inputSchema) {
    if (!inputSchema || typeof inputSchema !== "object")
        return Type.Any();
    const schema = inputSchema;
    const type = schema.type;
    if (type === "object" && typeof schema.properties === "object" && schema.properties !== null) {
        const props = {};
        for (const [key, val] of Object.entries(schema.properties)) {
            props[key] = toTypeBoxSchema(val);
        }
        return Type.Object(props, { additionalProperties: true });
    }
    if (type === "string")
        return Type.String();
    if (type === "number" || type === "integer")
        return Type.Number();
    if (type === "boolean")
        return Type.Boolean();
    if (type === "array")
        return Type.Array(toTypeBoxSchema(schema.items));
    if (type === "null")
        return Type.Null();
    // Unknown / complex schemas: pass through verbatim so the LLM still sees
    // the real structure.
    return Type.Unsafe(inputSchema);
}
/** Serialize an MCP tool result into pi's AgentToolResult shape. */
function toPiToolResult(result) {
    const content = [];
    if (Array.isArray(result.content)) {
        for (const block of result.content) {
            const b = block;
            if (b?.type === "text" && typeof b.text === "string") {
                content.push({ type: "text", text: b.text });
            }
            else if (b?.type === "image") {
                content.push({ type: "text", text: "[image]" });
            }
            else if (b) {
                content.push({ type: "text", text: JSON.stringify(b) });
            }
        }
    }
    if (content.length === 0)
        content.push({ type: "text", text: "(no content)" });
    return { content, details: {}, isError: result.isError === true };
}
export default function (pi) {
    // ── LOAD-TIME SAFE (pure computation + registrations only) ──────────
    const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
    /** Tool names already registered into THIS pi instance (session_start can
     *  fire multiple times per instance: startup/new/resume/fork/reload). */
    const registeredTools = new Set();
    /** Get the shared client for a server, connecting once per process. */
    async function ensureClient(server, cwd) {
        const key = serverKey(server);
        if (sharedClients.has(key))
            return sharedClients.get(key);
        if (connecting.has(key)) {
            await connecting.get(key);
            return sharedClients.get(key);
        }
        const cfg = server.config;
        const promise = (async () => {
            const client = new Client({ name: `pi-web-mcp:${server.name}`, version: "0.1.0" });
            const transportType = cfg.type ?? (cfg.url ? "http" : "stdio");
            if (transportType === "http" && cfg.url) {
                const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
                const transport = new StreamableHTTPClientTransport(new URL(cfg.url));
                await client.connect(transport);
            }
            else {
                if (!cfg.command)
                    throw new Error("missing command");
                // A session's cwd may point at a deleted directory (old session on a
                // removed project). spawn with a nonexistent cwd fails → cross-spawn
                // reports a fake ENOENT. Fall back to the daemon's own cwd.
                const spawnCwd = cfg.cwd ?? cwd;
                const transport = new StdioClientTransport({
                    command: cfg.command,
                    args: cfg.args ?? [],
                    env: cfg.env ?? {},
                    cwd: existsSync(spawnCwd) ? spawnCwd : process.cwd(),
                });
                await client.connect(transport);
            }
            // Cache the tool list once per process.
            const listed = await client.listTools();
            sharedToolCache.set(key, listed.tools);
            sharedClients.set(key, client);
        })();
        connecting.set(key, promise);
        try {
            await promise;
            return sharedClients.get(key);
        }
        catch (err) {
            console.warn(`[mcp] failed to connect "${server.name}": ${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
        finally {
            connecting.delete(key);
        }
    }
    /** Register a server's tools into THIS pi instance (idempotent). */
    async function registerServerTools(server, cwd) {
        const key = serverKey(server);
        const client = await ensureClient(server, cwd);
        if (!client)
            return;
        const tools = sharedToolCache.get(key) ?? [];
        for (const tool of tools) {
            const toolName = tool.name;
            const fullName = toolName.includes(".") ? toolName : `${server.name}_${toolName}`;
            if (registeredTools.has(fullName))
                continue;
            try {
                pi.registerTool({
                    name: fullName,
                    label: tool.description ?? toolName,
                    description: tool.description ?? `MCP tool from server "${server.name}"`,
                    parameters: toTypeBoxSchema(tool.inputSchema),
                    async execute(_toolCallId, params) {
                        try {
                            // Look up the CURRENT shared client at call time (survives reconnect).
                            const current = sharedClients.get(key);
                            if (!current) {
                                return { content: [{ type: "text", text: "MCP server not connected" }], details: {}, isError: true };
                            }
                            const result = await current.callTool({
                                name: toolName,
                                arguments: params,
                            });
                            return toPiToolResult(result);
                        }
                        catch (err) {
                            return {
                                content: [{ type: "text", text: `MCP tool error: ${err instanceof Error ? err.message : String(err)}` }],
                                details: {},
                                isError: true,
                            };
                        }
                    },
                });
                registeredTools.add(fullName);
            }
            catch (err) {
                console.warn(`[mcp] failed to register tool "${fullName}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    /** Connect + register all enabled servers (best-effort, never blocks). */
    async function connectAll(cwd) {
        try {
            const servers = loadServers(agentDir, cwd);
            if (servers.length === 0)
                return;
            for (const server of servers) {
                await registerServerTools(server, cwd);
            }
        }
        catch (err) {
            console.warn(`[mcp] connectAll failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** Close all shared connections + clear caches (used by /mcp reconnect). */
    async function reconnectAll(cwd) {
        for (const [key, client] of sharedClients) {
            try {
                await client.close();
            }
            catch {
                // best-effort
            }
            sharedClients.delete(key);
            sharedToolCache.delete(key);
        }
        registeredTools.clear();
        await connectAll(cwd);
    }
    pi.on("session_start", async (event, ctx) => {
        try {
            // Always connect + register: session_start fires on reload too, and
            // the runner is fresh (tools cleared). registeredTools (module-level)
            // must be cleared so every tool re-registers into the new runner.
            // hasExistingMcpAdapter is intentionally skipped — the built-in MCP
            // extension is the primary adapter; if another adapter also provides
            // MCP tools, they coexist without deconfliction.
            const cwd = ctx.cwd ?? process.cwd();
            registeredTools.clear();
            void connectAll(cwd).catch(() => { });
        }
        catch {
            // MCP must never break a session.
        }
    });
    pi.on("session_shutdown", () => {
        // Shared connections live for the daemon process lifetime — a session
        // ending must NOT close connections other parallel sessions still use.
        // The OS reclaims MCP child processes when the daemon exits.
    });
    // ── TOP-LEVEL command registration (allowed at load time — registration
    // only, not an action-method call).
    pi.registerCommand("mcp", {
        description: "List configured MCP servers and their connection status",
        handler: async (args, ctx) => {
            try {
                const cwd = ctx.cwd ?? process.cwd();
                const servers = loadServers(agentDir, cwd);
                if (servers.length === 0) {
                    ctx.ui.notify("MCP: no servers configured (add them in the web GUI → 设置 → MCP 服务器)", "info");
                    return;
                }
                const lines = servers.map((s) => {
                    const state = sharedClients.has(serverKey(s)) ? "connected" : "not connected";
                    return `${s.name}: ${state}`;
                });
                ctx.ui.notify(`MCP servers:\n${lines.join("\n")}`, "info");
                if (args.trim() === "reconnect") {
                    await reconnectAll(cwd);
                }
            }
            catch {
                // non-fatal
            }
        },
    });
}
//# sourceMappingURL=index.js.map