import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { tr } from "@vagus/ui-shared";
import { useTokens } from "@vagus/ui-tokens";
import { ChatMessage, WorkBlock, groupChatItems, dedupeThinking, TurnDiffSummary } from "@vagus/ui-chat";
import type { ChatItem, TurnFile } from "@vagus/ui-chat";
import type { RefObject } from "react";
import { HistoryNav } from "./history-nav.js";
import { InputCard } from "./input-card.js";
import { StatusDock } from "./status-dock.js";
import { ToastHost } from "./toast-host.js";
import type { InputCardProps } from "./input-card.js";
import { UiCard } from "./ui-card.js";
import type { UiCardItem } from "./ui-card.js";
import type { Autoscroll } from "@vagus/ui-hooks";

/**
 * The chat pane: sidebar-less conversation view with the live timeline,
 * history nav rail, jump-to-bottom float, and the message input card.
 * Rendering is a pure function of the active session slot — no state here.
 */
export function ChatPane(props: {
  items: ChatItem[];
  busy: boolean;
  turnStartTs?: number;
  /** Whether the session is being opened from disk (loading spinner). */
  sessionLoading: boolean;
  /** Loading hint appears only after 300ms — fast switches stay invisible. */
  showLoading: boolean;
  autoscroll: Autoscroll;
  onToggleCard: (id: number) => void;
  copyMessage: (text: string) => void;
  editSubmit: (text: string) => void;
  /** Fork the session from this user message (派生). */
  onFork?: (messageId: number, matchText: string, displayText: string) => void;
  /** Extension statuses/widgets for the hover dock (ctx.ui.setStatus / setWidget). */
  dockStatuses?: Record<string, string>;
  dockWidgets?: Record<string, { lines: string[] }>;
  /** Transient toast (ctx.ui.notify) — centered over the composer column. */
  toast?: ReactNode;
  inputCard: Omit<InputCardProps, "variant">;
  /** 当前对话名称（中间栏顶栏显示）。 */
  sessionName?: string;
  /** 当前对话的工作目录（顶栏显示，带文件图标）。 */
  sessionCwd?: string;
  /** Active session id — HistoryNav scrolls its rail to the bottom on switch. */
  activeId?: string;
  /** Open the right-pane diff viewer on a file (optionally with its turn's files). */
  onOpenFile: (file: string, turnFiles?: TurnFile[]) => void;
  /** Undo this turn's file changes (atomic batch); resolves with the outcome. */
  onRevertAll: (files: string[]) => void;
  /** Inline extension-UI cards for THIS session, in trigger order (pending + answered). */
  uiCards?: UiCardItem[];
  /** User answered a card — frontend sends ui.respond and marks it answered. */
  onUiCardRespond?: (card: UiCardItem, result: { confirmed?: boolean; value?: string; cancelled?: boolean }) => void;
  /** Lazy-load an earlier page of history (fired when scrolled to the top). */
  onLoadMore?: () => void;
  /** True while an earlier history page is being fetched. */
  loadingMore?: boolean;
  /** Sidebar is collapsed — widen the chat's max width to use the space. */
  wide?: boolean;
}): JSX.Element {
  const t = useTokens();
  const { items, busy, turnStartTs, autoscroll } = props;
  const { scrollRef, refCallback, showBottomBtn } = autoscroll;
  const uiCards = props.uiCards ?? [];
  // Auto-scroll policy: new pending cards (a new question waiting for the
  // user) scroll the NEWEST pending card into view — not the container bottom.
  // Cards are anchored inside a work block (after the trigger tool), which may
  // have content below it (thinking, final reply) — scrolling to the bottom
  // overshoots and the card is left out of the viewport.
  const pendingIds = uiCards
    .filter((c) => c.status === "pending")
    .map((c) => c.event.id)
    .join(",");
  const [prevPendingIds, setPrevPendingIds] = useState("");
  useEffect(() => {
    if (pendingIds.length > 0 && pendingIds !== prevPendingIds) {
      setPrevPendingIds(pendingIds);
      const el = scrollRef.current;
      if (!el) return;
      const pending = el.querySelectorAll('[data-uicard-status="pending"]');
      const last = pending[pending.length - 1] as HTMLElement | undefined;
      if (!last) return;
      // Manual smooth scroll so the direction/endpoint are predictable: put
      // the NEW card's bottom ~72px above the container's bottom, scrolling
      // DOWN like a normal chat stream follow, over 750ms (browser-native
      // smooth can be janky/too fast).
      const elRect = el.getBoundingClientRect();
      const cardRect = last.getBoundingClientRect();
      // distance from the card's bottom to the container's visible bottom
      const below = cardRect.bottom - elRect.bottom;
      // If the card is already fully visible (bottom above container bottom),
      // don't scroll. Otherwise bring its bottom up to 72px above the bottom.
      if (below <= 0 && cardRect.top >= elRect.top) return;
      const gap = 72;
      const delta = below > 0 ? below + gap : cardRect.top - elRect.top - gap;
      autoscroll.animatedScrollBy(delta, 750);
    }
  }, [pendingIds, autoscroll]);

  // Scroll-to-top lazy-load trigger: when the user scrolls near the top and
  // older messages exist, request the next history page. Re-attached every
  // render so props.loadingMore / onLoadMore stay fresh.
  useEffect(() => {
    const el = scrollRef.current;
    const onLoadMore = props.onLoadMore;
    if (!el || !onLoadMore) return;
    const onScroll = (): void => {
      if (el.scrollTop < 200 && !props.loadingMore) onLoadMore();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  });

  // Keep the visual anchor when earlier messages are prepended above the
  // viewport: record scrollHeight before each render and, on growth while the
  // user is near the top, offset scrollTop by the added height. Otherwise the
  // lazy-loaded page would shove the current view down unexpectedly.
  const prevScrollHeightRef = useRef(0);
  const prevItemsLenRef = useRef(0);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prevHeight = prevScrollHeightRef.current;
    const grew = items.length > prevItemsLenRef.current;
    prevItemsLenRef.current = items.length;
    if (grew && prevHeight > 0 && el.scrollTop < 400) {
      const delta = el.scrollHeight - prevHeight;
      // Only offset for large insertions (a lazy-loaded page ~200 messages).
      // Single new messages (live stream) while the user is near the top
      // should NOT shift the view — content grows below, not above.
      if (delta > 300) el.scrollTop += delta;
    }
    prevScrollHeightRef.current = el.scrollHeight;
  });

  // Strip duplicate reasoning cards + group into work blocks — memoized so
  // typing in the input (which re-renders the tree) doesn't re-parse.
  const groups = useMemo(() => groupChatItems(dedupeThinking(items)), [items]);
  // Extension-UI cards anchor to the work block containing the TOOL CALL that
  // triggered them (toolCallId is stamped by the engine and survives reloads).
  // This is immune to missing turn records in the session file. Matching is
  // toolCallId first, turn second; NO third fallback — an unmatched card
  // renders only while pending (see the unmatched section below).
  const cardsByTurn = useMemo(() => {
    // toolCallId → group index (the work block that ran that tool).
    const toolToGroup = new Map<string, number>();
    // turn (user-message ordinal) → first work-block index of that turn.
    const turnToGroup = new Map<number, number>();
    let turnNo = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!;
      if (g.kind === "item" && g.item.kind === "user") {
        turnNo++;
        continue;
      }
      if (g.kind === "work") {
        if (!turnToGroup.has(turnNo)) turnToGroup.set(turnNo, i);
        for (const w of g.work) {
          if (w.kind === "tool" && w.toolCallId) toolToGroup.set(w.toolCallId, i);
        }
      }
    }
    const byIdx = new Map<number, UiCardItem[]>();
    const matched = new Set<string>();
    for (const c of uiCards) {
      const ev = c.event as { turn?: number; toolCallId?: string };
      let gi = ev.toolCallId ? toolToGroup.get(ev.toolCallId) : undefined;
      if (gi === undefined) gi = ev.turn === undefined ? undefined : turnToGroup.get(ev.turn);
      // NO fallback-to-latest-block: an unmatched card's context simply
      // isn't loaded yet (lazy pagination) — piling answered history onto
      // the newest tool block was the "history clumps at the bottom" bug.
      // Pending cards still render via the unmatched section below.
      if (gi !== undefined) {
        const arr = byIdx.get(gi) ?? [];
        arr.push(c);
        byIdx.set(gi, arr);
        matched.add(c.event.id);
      }
    }
    const unmatched = uiCards.filter((c) => c.event.id === undefined || !matched.has(c.event.id));
    return { byIdx, unmatched };
  }, [groups, uiCards]);

  return (
    <div
      ref={refCallback}
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative", overflowY: "auto", overflowX: "hidden" }}
    >
      {/* 中间栏顶栏：对话名称 + 工作目录 —— sticky 悬浮，滚动条贯穿整个右缘 */}
      <header
        style={{
          position: "sticky", top: 0, zIndex: 20,
          flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
          height: 54, padding: "0 24px",
          background: t.color.bg, borderBottom: `1px solid ${t.color.border}`,
        }}
      >
        {props.sessionName ? (
          <span style={{ fontSize: "0.92em", fontWeight: 600, color: t.color.fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "38%" }}>
            {props.sessionName}
          </span>
        ) : null}
        {props.sessionName && props.sessionCwd ? (
          <span style={{ color: t.color.border, flexShrink: 0, fontSize: "0.85em" }}>|</span>
        ) : null}
        {props.sessionCwd ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, color: t.color.muted, fontSize: "0.85em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flexShrink: 0 }}>
              <path d="M7 3h7l5 5v13H7z" strokeLinejoin="round" />
              <path d="M14 3v5h5" strokeLinejoin="round" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{props.sessionCwd}</span>
          </span>
        ) : null}
      </header>
      {/* 时间线导航的 sticky 锚点：height 0，rail 用 absolute 定位在此锚点内，
          随滚动容器固定在视口中（不再随内容滚走）。 */}
      <div style={{ position: "sticky", top: 0, height: 0, zIndex: 5 }}>
        <HistoryNav items={items} scrollRef={scrollRef as RefObject<HTMLElement | null>} activeId={props.activeId} />
      </div>
      <div style={{ flex: "1 0 auto", paddingTop: 28 }}>
        <div style={{ maxWidth: props.wide ? 1280 : 1050, margin: "0 auto", padding: "0 28px", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Lazy-load indicator — shown at the top while an earlier page is fetched. */}
          {props.loadingMore && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", padding: "10px 0", color: t.color.muted, fontSize: "0.82em" }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${t.color.border}`, borderTopColor: t.color.primary, animation: "vagus-spin 0.8s linear infinite", display: "inline-block" }} />
              {tr("加载更早消息…")}
            </div>
          )}
          {items.length === 0 && (
            props.showLoading ? (
              <div style={{ color: t.color.muted, fontSize: "1em", textAlign: "center", marginTop: 40 }}>{tr("加载会话…")}</div>
            ) : !props.sessionLoading ? (
              <div style={{ color: t.color.muted, fontSize: "1em", textAlign: "center", marginTop: 40 }}>{tr("已连接 · 输入消息开始新会话")}</div>
            ) : null
          )}
          {(() => {
            // The "live" work block = the one containing the last work
            // item after the last user message. Stable across streaming
            // (intermediate replies join the same group), so the block
            // only auto-collapses when the turn really ends (busy=false).
            let lastUserIdx = -1;
            for (let i = items.length - 1; i >= 0; i--) {
              if (items[i]!.kind === "user") {
                lastUserIdx = i;
                break;
              }
            }
            let curWorkItem: ChatItem | undefined;
            for (let i = items.length - 1; i > lastUserIdx; i--) {
              const it = items[i]!;
              if (it.kind === "thinking" || it.kind === "tool") {
                curWorkItem = it;
                break;
              }
            }
            const liveGroup =
              busy && curWorkItem !== undefined
                ? groups.find((g) => g.kind === "work" && g.work.some((w) => w.id === curWorkItem?.id))
                : undefined;
            // Extension-UI cards anchor to the work block of the TURN they
            // belong to (each card records its `turn`; tool-bearing blocks are
            // numbered 1..N in order). Cards without a turn (legacy records)
            // fall back to the LAST tool block. This keeps each questionnaire
            // at its own turn instead of piling up on the newest one.
            const out: JSX.Element[] = [];
            let gi = 0;
            let userMsgIndex = 0;
            // Thin wrapper per group: browser skips off-screen rendering —
            // long sessions with many DOM nodes stay fast. "auto" intrinsic
            // size remembers the rendered height after first paint.
            const cvStyle: CSSProperties = { contentVisibility: "auto", containIntrinsicSize: "auto 120px" };
            // The final answer of each turn = the last assistant plain-item
            // before the next user message (or end of list). Only those get a
            // copy button, and only once the agent has finished (not busy).
            const lastFinalReplyIds = new Set<number>();
            {
              let lastAssistantId: number | undefined;
              for (const grp of groups) {
                if (grp.kind === "item") {
                  if (grp.item.kind === "assistant") lastAssistantId = grp.item.id;
                  else if (grp.item.kind === "user" && lastAssistantId !== undefined) {
                    lastFinalReplyIds.add(lastAssistantId);
                    lastAssistantId = undefined;
                  }
                } else if (grp.kind === "work" || grp.kind === "turnSummary") {
                  // A new work block closes the previous turn's final reply.
                  if (lastAssistantId !== undefined) lastFinalReplyIds.add(lastAssistantId);
                  lastAssistantId = undefined;
                }
              }
              if (lastAssistantId !== undefined) lastFinalReplyIds.add(lastAssistantId);
            }
            for (const group of groups) {
              if (group.kind === "item") {
                const item = group.item;
                if (item.kind === "user") {
                  // Wrap user messages so the history nav can locate them.
                  out.push(
                    <div key={`g${gi}`} data-msg-index={userMsgIndex++} style={{ maxWidth: "100%", ...cvStyle }}>
                      <ChatMessage item={item} onToggleCard={props.onToggleCard} onCopy={props.copyMessage} onEditSubmit={props.editSubmit} onFork={props.onFork} />
                    </div>,
                  );
                } else {
                  out.push(
                    <div key={`g${gi}`} style={cvStyle}>
                      <ChatMessage
                        item={item}
                        onToggleCard={props.onToggleCard}
                        onCopy={props.copyMessage}
                        onEditSubmit={props.editSubmit}
                        onFork={props.onFork}
                        showCopy={item.kind === "assistant" && lastFinalReplyIds.has(item.id) && !busy}
                      />
                    </div>,
                  );
                }
              } else if (group.kind === "turnSummary") {
                // Per-turn change summary (Zed-style): files this turn edited,
                // with per-file review/open and a whole-turn undo.
                out.push(
                  <div key={`t${gi}`} style={cvStyle}>
                    <TurnDiffSummary
                      files={group.files}
                      onOpenFile={props.onOpenFile}
                      onRevertAll={() => props.onRevertAll(group.files.map((f) => f.file))}
                    />
                  </div>,
                );
              } else {
                // One work block per user turn — the final answer is a
                // plain item already emitted by groupChatItems. Extension-UI
                // cards attach right after the trigger tool (chronological —
                // before any following thinking/reply), inside the block so
                // they collapse with it.
                const { work } = group;
                const wk = work[0]?.id ?? gi;
                const live = group === liveGroup;
                // Cards anchored to THIS turn's block (from the memoized map).
                const blockCards = cardsByTurn.byIdx.get(gi) ?? [];
                const attached =
                  blockCards.length > 0
                    ? blockCards.map((card, i) => (
                        <div key={`uicardwrap-${card.event.id ?? i}`} data-uicard-id={card.event.id} data-uicard-status={card.status}>
                          <UiCard
                            card={card}
                            onRespond={(result) => props.onUiCardRespond?.(card, result)}
                          />
                        </div>
                      ))
                    : undefined;
                // The tool that triggered the cards = each card's OWN toolCallId
                // (ask_user_question is the final tool call before the
                // questionnaire waits for the user). Anchor each card to its
                // exact tool; fall back to the block's last tool only when the
                // id is unknown (e.g. reloaded sessions without tool trends).
                let anchorIdx = -1;
                if (blockCards.length > 0) {
                  for (let k = group.work.length - 1; k >= 0; k--) {
                    if (group.work[k]!.kind === "tool") { anchorIdx = k; break; }
                  }
                  const ev = blockCards[0]!.event as { toolCallId?: string };
                  if (typeof ev.toolCallId === "string" && ev.toolCallId) {
                    const own = group.work.findIndex((w) => w.kind === "tool" && w.toolCallId === ev.toolCallId);
                    if (own >= 0) anchorIdx = own;
                  }
                }
                out.push(
                  <div key={`w${wk}`} style={cvStyle}>
                    <WorkBlock
                      work={work}
                      onToggleItem={(id: number) => props.onToggleCard(id)}
                      live={live}
                      startMs={turnStartTs}
                      attached={attached}
                      attachedAnchor={anchorIdx >= 0 ? anchorIdx : undefined}
                    />
                  </div>,
                );
              }
              gi++;
            }
            return <>{out}</>;
          })()}
          {/* Unmatched PENDING cards only (waiting for an answer — they must
              always be visible). Answered cards that don't match yet have
              their context unloaded (lazy pagination); they anchor once the
              user scrolls up and their turn's messages load. */}
          {cardsByTurn.unmatched.some((c) => c.status === "pending") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {cardsByTurn.unmatched.filter((c) => c.status === "pending").map((card, i) => (
                <div key={`uicardwrap-${card.event.id ?? i}`} data-uicard-id={card.event.id} data-uicard-status={card.status}>
                  <UiCard
                    card={card}
                    onRespond={(result) => props.onUiCardRespond?.(card, result)}
                  />
                </div>
              ))}
            </div>
          )}
          {/* Waiting indicator — shown when the agent is working but hasn't
              produced any thinking/text output yet (e.g. model request in flight). */}
          {busy && items.length > 0 && items[items.length - 1]!.kind === "user" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", color: t.color.muted, fontSize: "0.88em" }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
                animation: "vagus-pulse 1.2s ease-in-out infinite",
                display: "inline-block",
              }} />
              {tr("等待响应…")}
            </div>
          )}
          <div />
        </div>
      </div>
      {/* Jump-to-bottom float — lives INSIDE the sticky composer wrapper
          (which is always pinned to the viewport bottom), so it stays visible
          at all scroll positions. Rendered only when scrolled up. */}
      <div style={{ position: "sticky", bottom: 0, zIndex: 20, padding: "10px 28px 10px", background: t.color.bg, flexShrink: 0 }}>
        {showBottomBtn && (
          <button
            onClick={() => autoscroll.forceScrollToBottom()}
            title={tr("回到底部")}
            style={{
              position: "absolute",
              right: 18,
              top: -48,
              zIndex: 6,
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: t.color.surface,
              border: `1px solid ${t.color.border}`,
              color: t.color.muted,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
              transition: "background 0.15s, color 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.color.sidebarHover; e.currentTarget.style.color = t.color.fg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.color.surface; e.currentTarget.style.color = t.color.muted; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
          </button>
        )}
        <div style={{ maxWidth: props.wide ? 1180 : 960, margin: "0 auto", position: "relative" }}>
          <ToastHost toast={props.toast} />
          <InputCard {...props.inputCard} variant="chat" dock={props.dockStatuses || props.dockWidgets ? <StatusDock statuses={props.dockStatuses ?? {}} widgets={props.dockWidgets ?? {}} /> : undefined} />
        </div>
      </div>
    </div>
  );
}
