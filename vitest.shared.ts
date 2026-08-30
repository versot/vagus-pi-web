import { fileURLToPath } from "node:url";
import type { UserConfig } from "vitest/config";

/** Resolve a workspace-relative path from this config file. */
const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Shared test configuration (mirrors DeepSeek Harness's vitest.shared.ts).
 *
 * Unit and e2e configs both resolve workspace packages from source via
 * aliases, so `pnpm test` never requires a prior build step. Keep transport
 * differences (stdio vs WebSocket) out of here.
 */
export const workspaceAliases: UserConfig["resolve"] = {
  alias: {
    "@vagus/protocol": r("packages/protocol/src/index.ts"),
    "@vagus/ui-shared": r("packages/ui-shared/src/index.ts"),
    "@vagus/host-events": r("packages/host/events/src/index.ts"),
    "@vagus/host-session": r("packages/host/session/src/index.ts"),
    "@vagus/host-config": r("packages/host/config/src/index.ts"),
    "@vagus/host-models": r("packages/host/models/src/index.ts"),
    "@vagus/host-engine": r("packages/host/engine/src/index.ts"),
    "@vagus/ui-tokens": r("packages/ui-tokens/src/index.ts"),
    "@vagus/ui-chat": r("packages/ui-chat/src/index.ts"),
    "@vagus/ui-input": r("packages/ui-input/src/index.ts"),
    "@vagus/ui-sidebar": r("packages/ui-sidebar/src/index.ts"),
    "@vagus/ui-settings": r("packages/ui-settings/src/index.ts"),
    "@vagus/host-rpc": r("packages/host/rpc/src/index.ts"),
  },
};
