import { useCallback, useMemo, useState } from "react";
import type { JsonRpcClient } from "@vagus/ui-shared";
import type { ProviderConfigUI } from "@vagus/ui-tokens";

/**
 * Model configuration — provider list state plus save/refresh/test actions.
 * Self-contained: the App shell only consumes the returned values.
 */
export function useModels(client: JsonRpcClient | null) {
  const [modelsConfig, setModelsConfig] = useState<ProviderConfigUI[]>([]);

  const refreshModels = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.request("models.config");
      if (Array.isArray(result)) setModelsConfig(result as ProviderConfigUI[]);
    } catch { /* ignore */ }
  }, [client]);

  const saveModels = useCallback(async (providers: ProviderConfigUI[]) => {
    if (!client) return;
    try {
      await client.request("models.save", { providers });
      void refreshModels();
    } catch { /* UI stays as-is on failure */ }
  }, [client, refreshModels]);

  const testModel = useCallback(async (params: { baseUrl: string; api: string; apiKey?: string }) => {
    if (!client) return { ok: false };
    try {
      return (await client.request("models.test", params)) as { ok: boolean; status?: number };
    } catch {
      return { ok: false };
    }
  }, [client]);

  /** Model pickers only show enabled providers (disabled ones stay editable
   *  in the settings panel but are hidden from chat model selection). */
  const enabledProviders = useMemo(
    () => modelsConfig.filter((p) => p.enabled !== false),
    [modelsConfig],
  );

  return { modelsConfig, enabledProviders, refreshModels, saveModels, testModel };
}
