import { useEffect, useRef, useState } from "react";

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

  // Re-attach on session change: on first mount the chat <main> isn't
  // rendered yet (welcome screen), so the scroll listener would never attach.
  // Keying on activeId makes the effect re-run once a session exists.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = (): void => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      nearBottomRef.current = nearBottom;
      setShowBottomBtn(!nearBottom);
      // Only a USER scroll (not our programmatic scroll) changes the lock.
      if (!programmaticRef.current) {
        const goingUp = el.scrollTop < lastScrollTopRef.current;
        if (goingUp) scrollLockedRef.current = true;      // user scrolled up → lock
        else if (nearBottom) scrollLockedRef.current = false; // back at bottom → unlock
      }
      lastScrollTopRef.current = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeId]);

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
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      scrollToAbsolute(false);
      raf2 = requestAnimationFrame(() => scrollToAbsolute(false));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [activeId]);

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
   *  Pass `durationMs` for a custom-paced rAF animation (e.g. 750 for a
   *  leisurely scroll). The target is re-read every frame (scrollHeight may
   *  grow during the animation as new content arrives), so it lands exactly
   *  at the true bottom regardless of concurrent content growth. */
  const forceScrollToBottom = (smooth = true, durationMs?: number): void => {
    scrollLockedRef.current = false;
    if (durationMs !== undefined && durationMs > 0) {
      const el = scrollRef.current;
      if (!el) return;
      const start = el.scrollTop;
      const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
      programmaticRef.current = true;
      const begin = performance.now();
      const step = (now: number): void => {
        const t = Math.min(1, (now - begin) / durationMs);
        // Re-read scrollHeight every frame — content may grow during the
        // animation (the message is still being rendered), so the original
        // target would be stale.
        const target = el.scrollHeight - el.clientHeight;
        el.scrollTop = start + (target - start) * easeOutCubic(t);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          requestAnimationFrame(() => { programmaticRef.current = false; });
        }
      };
      requestAnimationFrame(step);
    } else {
      scrollToAbsolute(smooth);
    }
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
    const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
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
