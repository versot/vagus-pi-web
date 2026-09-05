import { useCallback, useState } from "react";
import type { JsonRpcClient } from "@vagus/ui-shared";
import type { SessionHistoryItem } from "@vagus/ui-tokens";

export interface ArchivedProject {
  cwd: string;
  /** Encoded archive-dir name — the unique identity of this archived group. */
  dirKey: string;
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

  /** Optimistic removals — the archived-dir rescan parses every JSONL and is
   *  far too slow to block the sidebar on; the background sync reconciles. */
  const removeArchivedProject = useCallback((dirKey: string) => {
    setArchivedProjects((prev) => prev.filter((p) => p.dirKey !== dirKey));
  }, []);

  const removeArchivedSession = useCallback((path: string) => {
    setArchivedProjects((prev) =>
      prev
        .map((p) => ({ ...p, sessions: p.sessions.filter((s) => s.path !== path) }))
        .filter((p) => p.sessions.length > 0),
    );
  }, []);

  const archiveProject = useCallback(async (cwd: string) => {
    if (!client) return;
    try {
      await client.request("project.archive", { cwd });
      void syncArchived(client);
      void refreshHistory(client);
    } catch { /* non-fatal */ }
  }, [client, syncArchived, refreshHistory]);

  const unarchiveProject = useCallback(async (dirKey: string) => {
    if (!client) return;
    try {
      await client.request("project.unarchive", { dirKey });
      removeArchivedProject(dirKey);
      void syncArchived(client);
      void refreshHistory(client);
    } catch { /* non-fatal */ }
  }, [client, syncArchived, refreshHistory, removeArchivedProject]);

  /** Permanently delete an archived project's files (confirm dialog first). */
  const deleteProject = useCallback(async (dirKey: string, sessions: SessionHistoryItem[], activePath: string | undefined) => {
    if (!client) return;
    confirm(
      "彻底删除项目",
      `将永久删除该归档会话文件，不可恢复。`,
      "彻底删除",
      () => {
        void (async () => {
          try {
            await client.request("project.delete", { dirKey });
            setArchivedProjects((prev) => prev.filter((p) => p.dirKey !== dirKey));
            // If the deleted project hosted the active session, clear it.
            if (activePath && sessions.find((s) => s.path === activePath)) {
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
          try {
            await client.request("session.deleteArchived", { sessionFile: path });
            // Optimistic removal — the background rescan (listArchivedProjects
            // parses every archived JSONL) is far too slow to block the UI on.
            setArchivedProjects((prev) =>
              prev
                .map((p) => ({ ...p, sessions: p.sessions.filter((s) => s.path !== path) }))
                .filter((p) => p.sessions.length > 0),
            );
            void syncArchived(client);
          } catch { /* non-fatal */ }
        })();
      },
    );
  }, [client, confirm, syncArchived]);

  /** Permanently delete every archived project (confirm dialog first). */
  const clearAllArchived = useCallback(() => {
    if (!client) return;
    confirm(
      "清空全部归档",
      `将永久删除全部 ${archivedProjects.length} 个归档项目的会话文件，不可恢复。`,
      "全部删除",
      () => {
        void (async () => {
          try {
            // Fire all deletions; each is an independent rmDirSafe on the
            // daemon side. Optimistically clear the list immediately.
            await Promise.allSettled(
              archivedProjects.map((p) => client.request("project.delete", { dirKey: p.dirKey })),
            );
            setArchivedProjects([]);
            void syncArchived(client);
          } catch { /* non-fatal */ }
        })();
      },
    );
  }, [client, confirm, archivedProjects, syncArchived]);

  return { archivedProjects, syncArchived, archiveProject, unarchiveProject, deleteProject, deleteArchivedSession, removeArchivedProject, removeArchivedSession, clearAllArchived };
}
