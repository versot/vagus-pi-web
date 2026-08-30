import { useCallback, useState } from "react";
import type { JsonRpcClient } from "@vagus/ui-shared";
import type { SessionHistoryItem } from "@vagus/ui-tokens";

export interface ArchivedProject {
  cwd: string;
  sessions: SessionHistoryItem[];
}

/**
 * Project/session archiving — state (archivedProjects) plus the actions that
 * read and mutate it, so the domain is self-contained in one hook.
 *
 * The only external dependency is a confirm-dialog trigger for permanent
 * deletes and a callback to clear the active session when it gets removed.
 */
export function useArchiving(
  client: JsonRpcClient | null,
  refreshHistory: (c: JsonRpcClient) => Promise<void>,
  confirm: (title: string, message: string, confirmLabel: string, onConfirm: () => void) => void,
  onSessionRemoved: (path: string) => void,
) {
  const [archivedProjects, setArchivedProjects] = useState<ArchivedProject[]>([]);

  const syncArchived = useCallback(async (c: JsonRpcClient) => {
    try {
      const list = (await c.request("project.archived", {})) as ArchivedProject[];
      if (Array.isArray(list)) setArchivedProjects(list);
    } catch { /* non-fatal */ }
  }, []);

  const archiveProject = useCallback(async (cwd: string) => {
    if (!client) return;
    try {
      await client.request("project.archive", { cwd });
      void syncArchived(client);
      void refreshHistory(client);
    } catch { /* non-fatal */ }
  }, [client, syncArchived, refreshHistory]);

  const unarchiveProject = useCallback(async (cwd: string) => {
    if (!client) return;
    try {
      await client.request("project.unarchive", { cwd });
      void syncArchived(client);
      void refreshHistory(client);
    } catch { /* non-fatal */ }
  }, [client, syncArchived, refreshHistory]);

  /** Permanently delete an archived project's files (confirm dialog first). */
  const deleteProject = useCallback(async (cwd: string, sessions: SessionHistoryItem[], activePath: string | undefined) => {
    if (!client) return;
    const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
    confirm(
      "彻底删除项目",
      `将永久删除“${name}”的归档会话文件，不可恢复。`,
      "彻底删除",
      () => {
        void (async () => {
          try {
            await client.request("project.delete", { cwd });
            setArchivedProjects((prev) => prev.filter((p) => p.cwd !== cwd));
            // If the deleted project hosted the active session, clear it.
            if (activePath && sessions.find((s) => s.path === activePath)?.cwd === cwd) {
              onSessionRemoved(activePath);
            }
            void refreshHistory(client);
          } catch { /* non-fatal */ }
        })();
      },
    );
  }, [client, confirm, onSessionRemoved, refreshHistory]);

  const deleteArchivedSession = useCallback(async (path: string) => {
    if (!client) return;
    confirm(
      "删除归档会话",
      "将永久删除该归档会话，不可恢复。",
      "删除",
      () => {
        void (async () => {
          try { await client.request("session.deleteArchived", { sessionFile: path }); void syncArchived(client); } catch { /* non-fatal */ }
        })();
      },
    );
  }, [client, confirm, syncArchived]);

  return { archivedProjects, syncArchived, archiveProject, unarchiveProject, deleteProject, deleteArchivedSession };
}
