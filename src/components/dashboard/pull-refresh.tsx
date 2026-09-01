import { useEffect, useRef, type HTMLAttributes, type ReactNode, type RefObject } from "react";

const THRESHOLD = 52;

export function usePullToRefresh(
  scroller: RefObject<HTMLElement | null>,
  onRefresh: () => void,
  enabled: boolean,
) {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) return;
    let startY = 0;
    let pulling = false;
    let dy = 0;
    const indicator = el.querySelector("[data-pull-refresh]") as HTMLElement | null;

    const setDy = (v: number) => {
      dy = Math.max(0, v);
      const shown = Math.min(72, dy * 0.5);
      if (indicator) {
        indicator.style.height = `${shown}px`;
        indicator.style.opacity = shown > 6 ? "1" : "0";
      }
    };

    const onStart = (e: TouchEvent) => {
      if (el.scrollTop > 1) {
        pulling = false;
        return;
      }
      startY = e.touches[0]?.clientY ?? 0;
      pulling = true;
      dy = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!pulling) return;
      if (el.scrollTop > 1) {
        pulling = false;
        setDy(0);
        return;
      }
      const y = e.touches[0]?.clientY ?? startY;
      const next = y - startY;
      if (next > 8) {
        if (e.cancelable) e.preventDefault();
        setDy(next);
      } else if (next < 0) {
        pulling = false;
        setDy(0);
      }
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      const fire = dy >= THRESHOLD;
      setDy(0);
      if (fire) cb.current();
    };

    el.addEventListener("touchstart", onStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onMove, { passive: false, capture: true });
    el.addEventListener("touchend", onEnd, { capture: true });
    el.addEventListener("touchcancel", onEnd, { capture: true });
    return () => {
      el.removeEventListener("touchstart", onStart, true);
      el.removeEventListener("touchmove", onMove, true);
      el.removeEventListener("touchend", onEnd, true);
      el.removeEventListener("touchcancel", onEnd, true);
      setDy(0);
    };
  }, [scroller, enabled]);
}

export function PullRefresh({
  onRefresh,
  enabled = true,
  className,
  children,
  ...rest
}: {
  onRefresh: () => void;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  usePullToRefresh(ref, onRefresh, enabled);
  return (
    <div ref={ref} className={className} data-pull-host="1" {...rest}>
      <div data-pull-refresh className="atalaya-pull" aria-hidden>
        Soltar para actualizar
      </div>
      {children}
    </div>
  );
}
