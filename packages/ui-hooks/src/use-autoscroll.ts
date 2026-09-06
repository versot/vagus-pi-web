import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Chat-pane auto-scroll behavior:
 *
 * LOCKING SEMANTICS — one upward user scroll locks ALL auto-scrolling off:
 *   - `scrollLockedRef` turns true when the user scrolls UP (away from the
 *     bottom). While locked, every auto-scroll trigger (stream follow, new
 *     message, card-answer follow, error, timeline growth) is a no-op.
 *   - It unlocks only when the user scrolls back to the bottom (<60px) —
 *     then auto-scroll resumes.
 *   - Explicit "jump to bottom" (floating button) and session switch are
 *     user-driven and always force-scroll + unlock.
 *
 * Programmatic scrolling (scrollToAbsolute) is flagged so it is never
 * mistaken for a user scroll — otherwise the forced scroll to bottom would
 * reset nearBottom and defeat the lock.
 */
/** The autoscroll handle — refs + actions consumed by the chat pane. */
export type Autoscroll = ReturnType<typeof useAutoscroll>;

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export function useAutoscroll(itemsCount: number, activeId: string | undefined) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const nearBottomRef = useRef(true);
  /** True once the user scrolls UP; all auto-scroll is suspended until they
   *  return to the bottom. */
  const scrollLockedRef = useRef(false);
  /** True while we are the ones moving the scrollbar (programmatic). */
  const programmaticRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const lastItemCountRef = useRef(0);
  const [showBottomBtn, setShowBottomBtn] = useState(false);
  // Bumped by refCallback whenever the scroll container mounts/unmounts (the
  // chat pane is unmounted while settings/plugins views are open) — the
  // listener/RO attach effect must re-run on those remounts, not only when
  // activeId changes.
  const [chatEpoch, setChatEpoch] = useState(0);
  const refCallback = useCallback((el: HTMLElement | null) => {
    scrollRef.current = el;
    setChatEpoch((n) => n + 1);
  }, []);

  // Re-attach on session change: on first mount the chat <main> isn't
  // rendered yet (welcome screen), so the scroll listener would never attach.
  // Keying on activeId makes the effect re-run once a session exists.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateBottomBtn = (): void => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      nearBottomRef.current = nearBottom;
      setShowBottomBtn(!nearBottom);
    };
    const onScroll = (): void => {
      updateBottomBtn();
      // Only a USER scroll (not our programmatic scroll) changes the lock.
      if (!programmaticRef.current) {
        const goingUp = el.scrollTop < lastScrollTopRef.current;
        if (goingUp) scrollLockedRef.current = true;      // user scrolled up → lock
        else if (nearBottomRef.current) scrollLockedRef.current = false; // back at bottom → unlock
      }
      lastScrollTopRef.current = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Virtualization (content-visibility:auto), image loads and streaming
    // growth all change scrollHeight WITHOUT a user scroll — a ResizeObserver
    // on the content wrapper keeps the button state honest for those too.
    const ro = new ResizeObserver(updateBottomBtn);
    for (const child of el.children) ro.observe(child);
    updateBottomBtn();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [activeId, chatEpoch]);

  // Session switch: always snap to the very bottom, regardless of the user's
  // scroll position — a different chat is a fresh context. Resetting
  // lastItemCountRef also makes the next growth count as a fresh load.
  // content-visibility:auto + containIntrinsicSize estimate off-screen items
  // on first paint, so scrollHeight under-reports the true bottom until the
  // lower messages actually lay out. Scroll twice across two frames: the
  // first brings the tail into view (forcing its real layout), the second
  // lands on the updated, accurate bottom.
  useEffect(() => {
    lastItemCountRef.current = 0;
    scrollLockedRef.current = false; // fresh context — drop any user scroll lock
    // forceScrollToBottom (not plain scrollToAbsolute): content-visibility
    // estimates settle into real layout AFTER the first frames, moving the
    // bottom further down — the chaser re-reads the target until 2 stable
    // frames. chatEpoch in deps covers remounts (settings/plugins views
    // unmount ChatPane; returning must snap to bottom just like a switch).
    const raf = requestAnimationFrame(() => forceScrollToBottom(false));
    return () => cancelAnimationFrame(raf);
  }, [activeId, chatEpoch]);

  // Scroll when the timeline grows (a new message arrived). Toggling a
  // thinking/tool card also changes item count, but not in a growing way
  // (collapse keeps the same length), so this only fires on real growth.
  // Snap (not smooth): streaming deltas keep growing scrollHeight, and a
  // smooth animation restarted on every delta lands short of the true bottom.
  useEffect(() => {
    const prevLen = lastItemCountRef.current;
    lastItemCountRef.current = itemsCount;
    const grew = itemsCount > prevLen;
    if (grew && !scrollLockedRef.current && nearBottomRef.current) {
      if (prevLen === 0) {
        // Fresh load of a (possibly long) session — content-visibility:auto
        // estimates off-screen items, so the first pass under-reports the
        // bottom. Scroll twice so the tail lays out then lands on the true
        // bottom. Streaming growth (prevLen > 0) keeps the single snap.
        requestAnimationFrame(() => {
          scrollToAbsolute(false);
          requestAnimationFrame(() => scrollToAbsolute(false));
        });
      } else {
        scrollToAbsolute(false);
      }
    }
  }, [itemsCount]);

  /** Follow the reasoning/answer stream — suspended while the user scrolled up. */
  const followStream = (): void => {
    if (scrollLockedRef.current) return;
    if (nearBottomRef.current) scrollToAbsolute(false);
  };

  /** Smoothly scroll to the very bottom (new message sent). Lock-aware. */
  const scrollToBottom = (smooth = true): void => {
    if (scrollLockedRef.current) return;
    scrollToAbsolute(smooth);
  };

  /** Force scroll to bottom + unlock — user-driven (jump button) or session switch.
   *  Always uses a rAF animation that re-reads the target every frame:
   *  content-visibility:auto estimates off-screen heights (120px/entry), so
   *  jumping straight to scrollHeight lands mid-list while the real layout
   *  expands below; re-reading until two consecutive stable frames guarantees
   *  the TRUE bottom (with or without concurrent content growth). */
  const forceScrollToBottom = (smooth = true, durationMs?: number): void => {
    scrollLockedRef.current = false;
    const el = scrollRef.current;
    if (!el) return;
    const dur = durationMs ?? (smooth ? 450 : 0);
    const start = el.scrollTop;
    programmaticRef.current = true;
    const begin = performance.now();
    let lastTarget = -1;
    let stableFrames = 0;
    const step = (now: number): void => {
      const t = dur > 0 ? Math.min(1, (now - begin) / dur) : 1;
      const target = el.scrollHeight - el.clientHeight;
      // Target settled (two identical frames) → snap & finish; keeps growing
      // (streaming) → keep chasing. Either way we land on the TRUE bottom.
      if (target === lastTarget) stableFrames++;
      else stableFrames = 0;
      lastTarget = target;
      el.scrollTop = start + (target - start) * easeOutCubic(t);
      if (t < 1 || stableFrames < 2) {
        requestAnimationFrame(step);
      } else {
        el.scrollTop = target;
        requestAnimationFrame(() => { programmaticRef.current = false; });
      }
    };
    requestAnimationFrame(step);
  };

  /**
   * Manual rAF-driven smooth scroll by a pixel delta over a fixed duration
   * (native `behavior: "smooth"` duration is browser-defined and can feel
   * too fast). Flags `programmaticRef` for the whole animation so the scroll
   * events are never mistaken for a user scroll.
   */
  const animatedScrollBy = (deltaY: number, durationMs = 500): void => {
    const el = scrollRef.current;
    if (!el || deltaY === 0) return;
    const start = el.scrollTop;
    const target = Math.max(0, start + deltaY);
    programmaticRef.current = true;
    const begin = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - begin) / durationMs);
      el.scrollTop = start + (target - start) * easeOutCubic(t);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        requestAnimationFrame(() => { programmaticRef.current = false; });
      }
    };
    requestAnimationFrame(step);
  };

  /** Force the next growth to snap (fresh chat — don't animate). */
  const resetSnap = (): void => {
    lastItemCountRef.current = 0;
  };

  /** Absolute scroll to the container's bottom (covers trailing padding). */
  const scrollToAbsolute = (smooth: boolean): void => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticRef.current = true;
    // A programmatic scroll to the bottom IS near-bottom — update it
    // synchronously so follow-up checks (user_queued, growth) don't read a
    // stale false before the async scroll event fires.
    nearBottomRef.current = true;
    try {
      if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else el.scrollTop = el.scrollHeight;
    } finally {
      // Clear the flag after this frame so the NEXT user scroll is recognized
      // as a user action (the programmatic scroll's own scroll event already
      // fired synchronously for the non-smooth path).
      requestAnimationFrame(() => {
        programmaticRef.current = false;
      });
    }
  };

  return {
    scrollRef,
    refCallback,
    nearBottomRef,
    scrollLockedRef,
    lastItemCountRef,
    showBottomBtn,
    followStream,
    scrollToBottom,
    forceScrollToBottom,
    animatedScrollBy,
    resetSnap,
  };
}
