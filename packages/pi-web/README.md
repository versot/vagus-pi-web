# @versot/vaguspi

A web frontend for the [pi coding agent](https://pi.dev). Launch the full
chat UI in your browser — no pi install required.

## Quick start

```bash
# Run without installing (recommended)
npx @versot/vaguspi web

# Or global install then run
npm install -g @versot/vaguspi
pi-web web
```

Opens `http://127.0.0.1:19707/` with chat, session history, model config,
MCP servers, skills, and usage stats.

## Install as a pi package

```bash
pi install npm:@versot/vaguspi
```

Installs the web frontend into your pi package directory (`~/.pi/agent/npm/`)
and lists it on [pi.dev/packages](https://pi.dev/packages). Launch with:

```bash
npx pi-web web
# or
~/.pi/agent/npm/@versot/vaguspi/dist/bin.js web
```

## How it works

`pi-web` embeds the pi SDK in-process and reuses your existing `~/.pi/agent`
configuration — models, auth, packages, MCP servers, and sessions are shared
with the pi CLI. It never writes to your pi config; it just reads it.

## Built-in MCP

The web GUI includes MCP server management (设置 → MCP 服务器). Servers
configured in `~/.pi/agent/mcp.json` connect lazily in web sessions; servers
with `"enabled": false` cost zero context.
