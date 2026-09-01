import { useEffect, type RefObject } from "react";

const THRESHOLD = 64;

/** iOS-style pull-to-refresh on a scroll container. Does not touch V1. */
export function usePullToRefresh(
  scroller: RefObject<HTMLElement | null>,
  onRefresh: () => void,
  enabled: boolean,
) {
  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) return;
    let startY = 0;
    let pulling = false;
    let dy = 0;
    const indicator = el.querySelector("[data-pull-refresh]") as HTMLElement | null;

    const setDy = (v: number) => {
      dy = v;
      if (indicator) {
        indicator.style.height = `${Math.min(80, Math.max(0, v * 0.45))}px`;
        indicator.style.opacity = v > 8 ? "1" : "0";
      }
    };

    const onStart = (e: TouchEvent) => {
      if (el.scrollTop > 0) {
        pulling = false;
        return;
      }
      startY = e.touches[0]?.clientY ?? 0;
      pulling = true;
      dy = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!pulling) return;
      const y = e.touches[0]?.clientY ?? startY;
      const next = Math.max(0, y - startY);
      if (next > 0 && el.scrollTop <= 0) {
        if (e.cancelable) e.preventDefault();
        setDy(next);
      } else {
        setDy(0);
      }
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      const fire = dy >= THRESHOLD;
      setDy(0);
      if (fire) onRefresh();
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scroller, onRefresh, enabled]);
}
