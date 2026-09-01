import type { AssetId } from "../trading/types";

export const LIVE_STALE_MS = 8_000;
export const LIVE_REST_MS = 12_000;
/** 3 missed 12s gold-api polls. Visual-only; never treat Bitget as spot. */
export const XAU_SPOT_STALE_MS = 36_000;

export type LiveQuoteSource = "ws" | "rest" | "snapshot";

export function wsTickIsFresh(lastWsAt: number | undefined, now: number, staleMs = LIVE_STALE_MS): boolean {
  return lastWsAt != null && now - lastWsAt < staleMs;
}

export function xauSpotIsFresh(fetchedAt: number | undefined, now: number, staleMs = XAU_SPOT_STALE_MS): boolean {
  return fetchedAt != null && fetchedAt > 0 && now - fetchedAt < staleMs;
}

/** Visual card/list price. XAU main is gold-api spot — never Bitget XAUUSDT. */
export function visualCardPrice(args: {
  id: AssetId;
  live: number | null | undefined;
  snapshotPrice: number | null | undefined;
  snapshotSpot: number | null | undefined;
}): { main: number | null; proxy: number | null } {
  const live = args.live != null && args.live > 0 ? args.live : null;
  if (args.id === "XAUUSD") {
    const spot = args.snapshotSpot != null && args.snapshotSpot > 0 ? args.snapshotSpot : null;
    return { main: live ?? spot, proxy: null };
  }
  const snap = args.snapshotPrice != null && args.snapshotPrice > 0 ? args.snapshotPrice : null;
  return { main: live ?? snap, proxy: null };
}

export function visualDelayed(source: LiveQuoteSource | undefined, hasPrice: boolean): boolean {
  if (!hasPrice) return true;
  return source !== "ws";
}
