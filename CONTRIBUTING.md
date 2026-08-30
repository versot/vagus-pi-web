# Contributing to Vagus

Thanks for your interest! Vagus is a pi-first agent orchestration product; every
contribution that keeps the code honest and the gates green is welcome.

## Development setup

Requirements: **Node.js >= 22** and **pnpm >= 9** (`corepack enable`).

> **Windows note:** use a recent Node from [nvm-windows](https://github.com/coreybutler/nvm-windows)
> and run all commands in PowerShell or Git Bash. `.cmd` shims are resolved
> automatically by the check scripts.

```bash
git clone https://github.com/<you>/vagus
cd vagus
corepack enable        # provides the pinned pnpm version
pnpm install
pnpm check:all         # lint + typecheck + unit tests + knip + jscpd
```

## Development loop

1. Create a branch: `git checkout -b feat/your-change`.
2. Write code + tests. Tests live next to sources under `tests/`:
   - `packages/**/tests/*.test.ts` — unit tests (vitest)
   - `e2e/**/*.e2e.ts` — end-to-end (vitest `--config vitest.e2e.config.ts`)
3. Run `pnpm check:all` locally — it is the same gate CI runs.
4. Add a changeset for user-facing changes: `pnpm changeset`.
5. Open a PR. CI must be green; reviewers expect ADRs updated when a design
   decision changes.

## Conventions

- Conventional commits (`feat(scope): subject`), enforced by lefthook.
- Strict TypeScript, no `any`. Schema-first wire contracts (see
  [AGENTS.md](AGENTS.md)).
- Public API in `packages/*` ships with JSDoc explaining the *why*.
- Respect the host/client boundary: frontends (`apps/gui`, `packages/ui-shared`) must not import Node-only code.

## Quality gates

| Gate | Tool | Command |
|------|------|---------|
| Lint | oxlint | `pnpm lint` |
| Typecheck | tsc -b (host + client) | `pnpm typecheck` |
| Unit tests | vitest | `pnpm test` |
| Dead code | knip | `pnpm knip` |
| Duplication | jscpd | `pnpm duplication` |

Coverage reporting exists (`pnpm test:coverage`); numeric thresholds are
enforced once the snapshot suite lands (M2).

## Reporting issues

See [SECURITY.md](SECURITY.md) for vulnerabilities. For everything else, open a
GitHub issue with a minimal repro and the output of `pnpm check:all`.

## Code of conduct

Be excellent to each other — see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
