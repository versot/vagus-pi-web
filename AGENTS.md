# AGENTS.md — conventions for AI agents working in this repo

vagusPI is an agent-native project: this file tells coding agents (pi, Claude Code,
Codex, ...) how to work here without breaking the build or the conventions.

> **Read [README.md](README.md) first** — it describes the product and the wire
> contracts. If the session was compacted, this file plus that one are the whole
> project memory.

## Repo map

Backend (Node):

- `packages/protocol/src/` — zod schemas. **The single source of truth for every
  wire contract.** Any change to a schema is a breaking change for clients; add a
  changeset.
- `packages/host/engine/src/` — session engine. `vagus-engine.ts` (pi SDK host,
  lazy ModelRuntime), `event-bus.ts` (typed bus), `store/session-store.ts`
  (**node:sqlite**, zero native deps).
- `packages/host/rpc/src/` — JSON-RPC server + transports.
- `apps/cli/src/commands/daemon.ts` — daemon wiring (30+ methods + event forwarding).

Frontend (React SPA, served by the daemon):

- `apps/gui/` — **thin entry only.** `src/main.tsx` mounts `AppRoot`; no business
  logic lives here. Vite config + `index.html` only.
- `packages/web/` — app assembly: `App.tsx` (composition root), domain hooks
  (`useModels`, `useArchiving`, `useDaemonEvents`).
- `packages/ui-hooks/` — state logic: `session-store.ts` (per-session slots),
  `use-autoscroll.ts`, `use-chat-input.ts`, `use-vagus-client.ts`, `transport.ts`.
- `packages/ui-panes/` — layout panes: `ChatPane`, `WelcomePane`, `InputCard`,
  `ConfirmDialog`, `HistoryNav`.
- `packages/ui-chat/` — message rendering (`messages.tsx`) and markdown
  (`markdown.tsx` renderer + `parse.ts` pure parser).
- `packages/ui-input/`, `ui-sidebar/`, `ui-settings/` — input bar, sidebar,
  settings views.
- `packages/ui-shared/`, `ui-tokens/` — protocol client / types, design tokens.

## Commands

```bash
pnpm build:web   # THE frontend gate: tsc -b (host+packages+gui) → vite → cli → copy
pnpm check:all   # backend gate: lint + typecheck + unit + knip + jscpd. Run before push.
pnpm test        # vitest (fast, no build needed)
pnpm lint        # oxlint
```

`build:web` runs on Windows PowerShell (WSL has no node). After a rebuild, hard-refresh
the browser (Ctrl+Shift+R) — stale bundles have bitten repeatedly.

## Frontend layout

- **`apps/gui` stays a shell.** All React code lives in `packages/*`. Adding
  business logic to `apps/gui/src` is a smell — it belongs in `packages/web` or
  a `ui-*` package.
- **Package responsibility is by layer:** `ui-hooks` = state + logic (no JSX
  markup beyond trivial), `ui-panes` = layout, `ui-chat` = message rendering,
  `ui-tokens` = theme, `ui-shared` = transport/types.
- **Imports:** package names across packages (`@vagus/ui-hooks`), relative
  `./file.js` (with `.js` suffix) within a package. ESM everywhere.

## Frontend conventions

1. **Keep files short.** ~500 lines is a rough ceiling, not a hard gate — a
   composition root (App.tsx) or a cohesive renderer (messages.tsx) can be
   larger. Split at clear responsibility boundaries, never to chase a line
   count.
2. **Split by cohesion, not by size.** A domain hook owns *its own state plus
   the actions that mutate it* (`useModels`, `useArchiving`) — passing state
   into a callbacks-only hook is parameter-hell and a wrong split.
3. **Pure logic separates from rendering.** Parsers/serializers/reducers are
   plain functions in their own file (`parse.ts`, `session-store.ts`) and are
   unit-testable without React.
4. **Every session gets a slot.** `session-store.ts` keeps
   `Record<sessionId, SessionSlot>` — switching chats activates a slot, never
   clears/reloads it. Background agents stream into their own slot.
5. **One event-routing entry.** All `DomainEvent`s flow through
   `useDaemonEvents` → store actions. Side effects (scroll, RPC refresh) fire
   only for the visible session; every slot still gets its own state update.
6. **Side effects stay in the event handler**, never inside the reducer —
   the reducer (`sessionStoreReducer`) is pure.
7. **Derive, don't duplicate.** `busyPaths` is derived from slot states; model
   pickers filter providers via `useModels`. No parallel `useState` copies.
8. **JSDoc on exports** explaining *why*, not just *what*. Concise.

## Styling

- **Brand:** indigo `#6366f1` → violet `#8b5cf6` gradient. Accent color is
  indigo; never invent new accent hues.
- **No grey-box cards.** Thinking/tool/work blocks use the brand-tinted
  gradient backgrounds (`rgba(99,102,241,…)`), never `t.color.surface`.
  `surface` is for neutral containers (dialogs, menus).
- **UI text is Chinese** (messages, labels, tooltips). Code identifiers,
  comments and commit messages stay English.
- **Inline styles** (project convention) via design tokens from `useTokens()`.
  CSS files only for global keyframes (e.g. `vagus-pulse`).

## Interaction rules

- **No toast/popup for feedback.** Copy success = button state flips to ✓;
  destructive confirmations use the in-app `ConfirmDialog`, never
  `window.confirm`.
- **Auto-scroll:** follow the stream only while the user is near the bottom;
  never yank the scrollbar while scrolled up. Sending a message always scrolls
  to the bottom; session switches snap (no top→bottom animation).
- **HistoryNav tooltip:** question on top, answer below with a gap, no labels,
  answer clamped to 2 lines.

## Host integration pitfalls (pi)

- **Version pins are load-bearing.** `overrides`/`patchedDependencies` in
  `pnpm-workspace.yaml` pin openai + pi packages — never bump them separately;
  the openai pin must stay in sync with `patches/openai@6.40.0.patch`.
- **One SessionManager per session file.** Never call `SessionManager.open` on
  a file whose session is live in `this.sessions` — reuse the active
  `sessionManager` (see `readSessionMessages`, `renameSessionFile`). Two
  writers to one JSONL corrupts it.
- **`closeActiveSession` disposes everything** — the multi-session model must
  not call it when switching chats; only `close()` (daemon shutdown) may.
- **DeepSeek thinking streams** emit unescaped `\n\n` in JSON — the openai SSE
  patch absorbs it; keep the patch, don't "fix" the provider side.

### Third-party API compatibility (new providers/models)

These are the real-world traps when wiring an OpenAI-compatible provider that
isn't in pi's built-in catalog (`pi-ai/dist/providers/data/`). Diagnose by
proxying the request (see below) — don't guess.

- **Base URL may need a path suffix.** Volcengine Ark's coding endpoint is
  `…/api/coding/v3` (the `/v3` matters): pi appends `/chat/completions`, so
  `…/api/coding/chat/completions` 404s and the turn silently ends.
- **`developer` role is not universal.** Some APIs only accept
  `system/assistant/user/tool` — set `compat.supportsDeveloperRole: false` or
  the request 400s and the turn ends with zero output.
- **Reasoning fields need `compat`.** If the response carries
  `reasoning_content` (DeepSeek, MiniMax-M3, …): set
  `compat.thinkingFormat: "deepseek"` and
  `compat.requiresReasoningContentOnAssistantMessages: true` (the latter is
  required for multi-turn — some APIs 400 if history reasoning isn't passed
  back).
- **Image data URLs must be raw base64 to pi.** pi's provider prefixes
  `data:${mimeType};base64,` itself — pass `data` WITHOUT the prefix, or the
  double prefix breaks image requests (MiniMax 404s).
- **Turn ends instantly with no output = the provider request failed silently.**
  Proxy the request to see it: `python3 /mnt/d/project/proxy.py 18080`,
  point the provider's baseUrl at `http://localhost:18080/…`, replay the
  failing action, read `/tmp/pi-request.log`.

### Model catalog auto-fill

Prefer adding models by ID from pi's built-in catalog (`models.catalog` RPC) —
it carries `compat`/`cost`/`contextWindow`/`reasoning`/`input` so users never
hand-write compat. The settings UI shows "已匹配目录" when the ID hits, and
"需手动配置" otherwise. `models.probe` (base request + developer-role probe +
image probe) auto-detects the three compat knobs above for custom endpoints.

## Conventions

1. **Strict TypeScript.** No `any`, no `@ts-ignore`. `noUncheckedIndexedAccess`
   is on — expect `possibly undefined` on indexed access.
2. **Schema-first.** New wire data → new zod schema in `@vagus/protocol` →
   inferred types. Never hand-roll a type for something that crosses the wire.
3. **host/client boundary.** Node-only code must not appear in client projects
   (`apps/gui`, `packages/ui-shared`). `types: []` in client
   tsconfigs enforces this — do not add `node` types there.
4. **Event-sourced state.** State transitions in core go through `EventBus`;
   UIs never mutate engine state directly.
5. **Conventional commits.** `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert(scope): subject`.
6. **Changesets.** Any user-facing change ships a changeset (`pnpm changeset`).
7. **No console.log in packages.** Use structured logging when it lands (M1);
   `apps/cli` may write to stdout/stderr for user-facing output.

## Do NOT

- Do not bump versions manually; changesets owns release versioning.
- Do not relax a schema to "fix" a test — fix the fixture or the producer.
- Do not import `@vagus/host-engine` into `apps/gui` (client boundary; frontends talk to the daemon over the protocol).
- Do not add a dependency without a changeset and a comment explaining why.
- Do not add business logic to `apps/gui/src` — it belongs in a package.
- Do not create a hook that takes state as parameters while the caller still
  owns it — split so the hook owns its state (cohesion), or keep the code in
  the caller.
- Do not open a second `SessionManager` on a live session's file.
