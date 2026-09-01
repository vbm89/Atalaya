import { useEffect, useRef } from "react";
import type { AssetId } from "@/lib/trading/types";
import { cn, formatPrice } from "@/lib/utils";
import {
  liveQuoteSources,
  liveQuotesSnapshot,
  liveXauSpot,
  liveXauSpotAt,
  subscribeLiveQuotes,
} from "@/lib/chart/live-quotes";
import { visualCardPrice, xauSpotIsFresh } from "@/lib/chart/quote-view";

export function LiveQuoteReadout({
  id,
  digits,
  snapshotPrice,
  snapshotSpot,
  size = "sm",
  align = "right",
}: {
  id: AssetId;
  digits: number;
  snapshotPrice: number | null | undefined;
  snapshotSpot: number | null | undefined;
  size?: "sm" | "lg";
  align?: "left" | "right";
}) {
  const mainRef = useRef<HTMLSpanElement>(null);
  const delayRef = useRef<HTMLSpanElement>(null);
  const isXau = id === "XAUUSD";

  const liveFor = () => (isXau ? liveXauSpot() : liveQuotesSnapshot()[id] ?? null);

  const isDelayed = () => {
    if (isXau) {
      const at = liveXauSpotAt();
      if (!at) return false;
      return !xauSpotIsFresh(at, Date.now());
    }
    const src = liveQuoteSources()[id];
    return src != null && src !== "ws";
  };

  const paint = () => {
    const shown = visualCardPrice({
      id,
      live: liveFor(),
      snapshotPrice,
      snapshotSpot,
    });
    const delayed = isDelayed();
    if (mainRef.current) {
      mainRef.current.textContent = shown.main == null ? "—" : formatPrice(shown.main, digits);
    }
    if (delayRef.current) delayRef.current.hidden = !delayed;
  };

  useEffect(() => subscribeLiveQuotes(paint), [id, digits, snapshotPrice, snapshotSpot]);

  const initial = visualCardPrice({
    id,
    live: liveFor(),
    snapshotPrice,
    snapshotSpot,
  });
  const delayed0 = isDelayed();

  return (
    <p
      className={cn(
        "font-mono font-medium tabular leading-none",
        size === "lg" ? "text-3xl tracking-tight" : "shrink-0 text-sm",
        align === "right" ? "text-right" : "text-left",
      )}
      data-live-price={id}
      data-live-kind={isXau ? "spot" : "last"}
    >
      <span ref={mainRef}>{initial.main == null ? "—" : formatPrice(initial.main, digits)}</span>
      {isXau ? (
        <span className="mt-1 block text-[10px] font-medium tracking-wide text-subtle uppercase">SPOT</span>
      ) : null}
      <span ref={delayRef} hidden={!delayed0} className="mt-1 block text-[10px] font-medium tracking-wide text-wait">
        RETRASADO
      </span>
    </p>
  );
}
