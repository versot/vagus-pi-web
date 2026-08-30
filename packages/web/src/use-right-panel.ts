import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { DIFF_TAB } from "@vagus/ui-panes";
import type { RightTab } from "@vagus/ui-panes";

/**
 * Right-panel state & persistence — extracted from App.tsx to keep the
 * composition root lean. Owns tabs, collapsed/expanded state, width,
 * per-session localStorage config, and the auto-open/close logic.
 */
export function useRightPanel(opts: {
  /** Current active session id (undefined on welcome screen). */
  activeId?: string;
  /** Whether the active session has file-edit diffs. */
  hasEdits: boolean;
}) {
  const { activeId, hasEdits } = opts;

  const [rightTabs, setRightTabs] = useState<RightTab[]>([]);
  const [rightTabId, setRightTabId] = useState<string | undefined>(undefined);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(420);
  const [handledFiles, setHandledFiles] = useState<Set<string>>(new Set());
  const [diffSelection, setDiffSelection] = useState<string | undefined>(undefined);
  /** Fingerprint (last toolCallId) of the turn whose 审阅 was opened — the
   *  right pane rebuilds that turn's files from the session items, so the diff
   *  is always current and storage stays tiny. */
  const [reviewTurnId, setReviewTurnId] = useState<string | undefined>(undefined);
  /** File expanded in the review list (per session+turn) — restored for full
   *  cross-switch consistency. */
  const [reviewOpen, setReviewOpenState] = useState<string[] | undefined>(undefined);
  /** True once the user manually closed the diff tab — persisted, so a reload
   *  doesn't auto-reopen it. */
  const [diffClosed, setDiffClosed] = useState(false);

  const STORAGE_KEY = "vagus.rightPanel.v1";
  /** Per-session memory of which turn's 审阅 was last opened. */
  const REVIEW_KEY = "vagus.rightPanel.review.v1";

  const readReview = (sid: string): { turnId?: string; selected?: string; open?: string[] } => {
    try {
      const raw = localStorage.getItem(REVIEW_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, { turnId?: string; selected?: string; open?: string[] }>) : {};
      const rec = map[sid];
      return { turnId: rec?.turnId, selected: rec?.selected, open: rec?.open };
    } catch {
      return {};
    }
  };
  const writeReview = (sid: string, turnId: string | undefined, selected: string, open: string[] | undefined): void => {
    try {
      const raw = localStorage.getItem(REVIEW_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, { turnId?: string; selected?: string; open?: string[] }>) : {};
      map[sid] = { turnId, selected, open };
      localStorage.setItem(REVIEW_KEY, JSON.stringify(map));
    } catch {
      /* storage unavailable — non-fatal */
    }
  };

  const readConfig = (sid: string): { collapsed: boolean; width: number; activeTab?: string; diffClosed?: boolean; has: boolean } => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, { collapsed?: boolean; width?: number; activeTab?: string; diffClosed?: boolean }>) : {};
      const rec = map[sid];
      return {
        collapsed: rec?.collapsed === true,
        width: rec?.width ?? 420,
        activeTab: rec?.activeTab,
        diffClosed: rec?.diffClosed === true,
        has: rec !== undefined,
      };
    } catch {
      return { collapsed: true, width: 420, has: false };
    }
  };

  const writeConfig = (sid: string, cfg: { collapsed: boolean; width: number; activeTab?: string; diffClosed?: boolean }): void => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, { collapsed: boolean; width: number; activeTab?: string; diffClosed?: boolean }>) : {};
      map[sid] = cfg;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* storage unavailable — non-fatal */
    }
  };

  // Switch session: restore per-session config.
  // Handled edits are stored by toolCallId (an edit instance), NOT file path,
  // so a NEW edit to an already-accepted file still appears for review.
  // v2 changed the payload from file paths to toolCallIds.
  const HANDLED_KEY = "vagus.rightPanel.handled.v2";
  const readHandled = (sid: string): Set<string> => {
    try {
      const raw = localStorage.getItem(HANDLED_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
      return new Set(Array.isArray(map[sid]) ? map[sid] : []);
    } catch {
      return new Set();
    }
  };
  const writeHandled = (sid: string, ids: Set<string>): void => {
    try {
      const raw = localStorage.getItem(HANDLED_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
      map[sid] = [...ids];
      localStorage.setItem(HANDLED_KEY, JSON.stringify(map));
    } catch {
      /* storage unavailable — non-fatal */
    }
  };

  useLayoutEffect(() => {
    if (!activeId) return;
    const cfg = readConfig(activeId);
    setRightPanelWidth(cfg.width);
    setRightCollapsed(cfg.has ? cfg.collapsed : true);
    if (cfg.activeTab !== undefined) setRightTabId(cfg.activeTab);
    // Respect the user's choice to close the diff tab across reloads.
    setDiffClosed(cfg.diffClosed === true);
    // Restore the turn whose 审阅 this session last opened (never aggregate).
    const saved = readReview(activeId);
    setReviewTurnId(saved.turnId || undefined);
    // Keep `[]` (all collapsed) distinct from `undefined` (never set).
    setReviewOpenState(Array.isArray(saved.open) ? saved.open : undefined);
    if (saved.selected) setDiffSelection(saved.selected);
    // Restore accepted/reverted files so they stay hidden after refresh.
    setHandledFiles(readHandled(activeId));
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist per-session config.
  useEffect(() => {
    if (!activeId) return;
    writeConfig(activeId, { collapsed: rightCollapsed, width: rightPanelWidth, activeTab: rightTabId, diffClosed });
  }, [rightCollapsed, rightPanelWidth, rightTabId, diffClosed, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist accepted/reverted files per session (hide them after refresh).
  useEffect(() => {
    if (!activeId) return;
    writeHandled(activeId, handledFiles);
  }, [handledFiles, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open/close 审阅 tab based on edits.
  useEffect(() => {
    if (hasEdits) {
      if (!diffClosed) {
        setRightTabs((prev) => (prev.some((t) => t.id === "diff") ? prev : [...prev, DIFF_TAB]));
        setRightTabId((prev) => prev ?? "diff");
      }
    } else {
      setRightTabs((prev) => (prev.some((t) => t.id === "diff") ? prev.filter((t) => t.id !== "diff") : prev));
      setRightTabId((prev) => (prev === "diff" ? undefined : prev));
    }
  }, [hasEdits, diffClosed]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFileDiff = useCallback((file: string, turnFiles?: Array<{ file: string; diff?: string; patch?: string; turnToolCallId?: string }>): void => {
    setDiffClosed(false);
    setDiffSelection(file);
    // Fingerprint of the turn being reviewed (shared by all its files).
    const turnId = turnFiles?.[0]?.turnToolCallId;
    setReviewTurnId(turnId);
    // The clicked file starts expanded.
    setReviewOpenState([file]);
    // Remember which turn's review this session last opened.
    if (activeId) writeReview(activeId, turnId, file, [file]);
    setRightCollapsed(false);
    setRightTabs((prev) => (prev.some((t) => t.id === "diff") ? prev : [...prev, DIFF_TAB]));
    setRightTabId("diff");
  }, [activeId]);

  const closeRightTab = useCallback((id: string): void => {
    if (id === "diff") setDiffClosed(true);
    setRightTabs((prev) => prev.filter((t) => t.id !== id));
    setRightTabId((prev) => (prev === id ? undefined : prev));
  }, []);

  /** Expand/collapse review rows (multiple) — persists so switching restores them. */
  const setReviewOpen = useCallback((files: string[] | undefined): void => {
    setReviewOpenState(files);
    if (activeId && reviewTurnId) {
      // `[]` persists an explicit "all collapsed" state.
      writeReview(activeId, reviewTurnId, diffSelection ?? files?.[0] ?? "", files ?? []);
    }
  }, [activeId, reviewTurnId, diffSelection]);

  return {
    rightTabs, rightTabId, rightCollapsed, rightPanelWidth, handledFiles, diffSelection, reviewTurnId, reviewOpen,
    setRightTabs, setRightTabId, setRightCollapsed, setRightPanelWidth, setHandledFiles, setDiffSelection,
    setReviewOpen, openFileDiff, closeRightTab,
  };
}