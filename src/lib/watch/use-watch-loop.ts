import { useEffect, useRef, useState } from "react";
import { ALIGN_MS, analysisCoversClose, shouldEvalNow, sleepUntilEvalMs } from "./schedule";

/**
 * Foreground-only watch loop. Aligns to 15M closes. Does not subscribe to
 * chart ticks. iOS Safari suspends this in the background — that is expected.
 */
export function useWatchLoop(opts: {
  lastEvalMs: number | null;
  busy: boolean;
  onEval: () => void;
  enabled?: boolean;
}): { visible: boolean } {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const lastEvalRef = useRef(opts.lastEvalMs);
  const busyRef = useRef(opts.busy);
  const onEvalRef = useRef(opts.onEval);
  const inFlightRef = useRef(false);
  const enabled = opts.enabled !== false;

  lastEvalRef.current = opts.lastEvalMs;
  busyRef.current = opts.busy;
  onEvalRef.current = opts.onEval;
  if (!opts.busy) inFlightRef.current = false;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let timer = 0;
    let align = 0;

    const kickIfDue = () => {
      if (document.visibilityState === "hidden") return;
      if (busyRef.current || inFlightRef.current) return;
      const now = Date.now();
      if (!shouldEvalNow(now, lastEvalRef.current)) return;
      inFlightRef.current = true;
      onEvalRef.current();
    };

    const arm = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      kickIfDue();
      const wait =
        busyRef.current || inFlightRef.current
          ? 400
          : Math.max(250, sleepUntilEvalMs(Date.now(), lastEvalRef.current));
      timer = window.setTimeout(arm, wait);
    };

    const onVis = () => {
      const vis = document.visibilityState !== "hidden";
      setVisible(vis);
      if (vis) arm();
      else window.clearTimeout(timer);
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onVis);
    arm();
    align = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      kickIfDue();
    }, ALIGN_MS);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(align);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onVis);
    };
  }, [enabled]);

  return { visible };
}

export function snapshotIsFresh(generatedAt: string | undefined, now = Date.now()): boolean {
  if (!generatedAt) return false;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return false;
  return analysisCoversClose(t, now);
}
