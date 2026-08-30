# vagusPI

English | [中文](README.zh.md)

vagusPI is an open-source **web GUI for the [pi coding agent](https://pi.dev)**.

It is not a separate agent or an isolated workspace. vagusPI reads and writes
the *same* `~/.pi/agent` configuration — models, sessions, packages, and
settings — that the pi CLI uses, so everything you do in the browser is
available in the terminal and vice versa. Your data stays on your machine.

## Run

### Run from `npm`

Install `Node.js >= 22`, then run:

```sh
npx @versot/vaguspi web
```

The command starts the Web UI at `http://127.0.0.1:19707` and opens it in
your default browser. No installation required.

### Install as a pi package

```sh
pi install npm:@versot/vaguspi
```

Then launch with:

```sh
pi-web web
```

## Features

- **Chat** — streamed responses with visible thinking, tool-call cards, and
  multi-turn conversations
- **Session history** — real pi session files, resumable from the web or the
  terminal; long conversations lazy-load as you scroll
- **Model management** — configure providers (API type, base URL, key,
  model list, reasoning level) with live credential checks
- **Built-in MCP** — MCP servers work per-session without a separate adapter
  package
- **Skills & commands** — the `/` palette lists pi commands, extension
  commands, skills, and templates
- **Usage stats** — token and cost rollups across all sessions

## Development

For agents, follow [AGENTS.md](AGENTS.md).

```sh
pnpm install
pnpm build             # build host packages
pnpm build:web         # build web UI + CLI bundle
pnpm test              # unit tests
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © versot
