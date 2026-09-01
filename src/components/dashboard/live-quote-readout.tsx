import { useEffect, useRef } from "react";
import type { AssetId } from "@/lib/trading/types";
import { formatPrice } from "@/lib/utils";
import {
  liveQuoteSources,
  liveQuotesSnapshot,
  subscribeLiveQuotes,
} from "@/lib/chart/live-quotes";
import { visualCardPrice } from "@/lib/chart/quote-view";

export function LiveQuoteReadout({
  id,
  digits,
  snapshotPrice,
  snapshotSpot,
}: {
  id: AssetId;
  digits: number;
  snapshotPrice: number | null | undefined;
  snapshotSpot: number | null | undefined;
}) {
  const mainRef = useRef<HTMLSpanElement>(null);
  const proxyRef = useRef<HTMLSpanElement>(null);
  const delayRef = useRef<HTMLSpanElement>(null);
  const snap = { id, snapshotPrice, snapshotSpot, digits };

  const paint = () => {
    const live = liveQuotesSnapshot()[id] ?? null;
    const src = liveQuoteSources()[id];
    const shown = visualCardPrice({
      id,
      live,
      snapshotPrice: snap.snapshotPrice,
      snapshotSpot: snap.snapshotSpot,
    });
    const delayed = src != null && src !== "ws";
    if (mainRef.current) {
      mainRef.current.textContent = shown.main == null ? "—" : formatPrice(shown.main, digits);
    }
    if (proxyRef.current) {
      if (id === "XAUUSD" && shown.proxy != null) {
        proxyRef.current.hidden = false;
        proxyRef.current.textContent = `PROXY Bitget ${formatPrice(shown.proxy, digits)}`;
      } else {
        proxyRef.current.hidden = true;
        proxyRef.current.textContent = "";
      }
    }
    if (delayRef.current) {
      delayRef.current.hidden = !delayed;
    }
  };

  useEffect(() => subscribeLiveQuotes(paint), [id, digits, snapshotPrice, snapshotSpot]);

  const initial = visualCardPrice({
    id,
    live: liveQuotesSnapshot()[id],
    snapshotPrice,
    snapshotSpot,
  });
  const delayed0 = liveQuoteSources()[id] != null && liveQuoteSources()[id] !== "ws";

  return (
    <p
      className="shrink-0 text-right font-mono text-sm font-medium tabular leading-none"
      data-live-price={id}
    >
      <span ref={mainRef}>{initial.main == null ? "—" : formatPrice(initial.main, digits)}</span>
      <span
        ref={proxyRef}
        hidden={!(id === "XAUUSD" && initial.proxy != null)}
        className="mt-1 block text-[10px] font-medium tracking-wide text-wait"
      >
        {id === "XAUUSD" && initial.proxy != null
          ? `PROXY Bitget ${formatPrice(initial.proxy, digits)}`
          : ""}
      </span>
      <span ref={delayRef} hidden={!delayed0} className="mt-1 block text-[10px] font-medium tracking-wide text-wait">
        RETRASADO
      </span>
    </p>
  );
}
