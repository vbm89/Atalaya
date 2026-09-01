import type { AssetId } from "../trading/types";

export const LIVE_STALE_MS = 8_000;
export const LIVE_REST_MS = 12_000;

export type LiveQuoteSource = "ws" | "rest" | "snapshot";

export function wsTickIsFresh(lastWsAt: number | undefined, now: number, staleMs = LIVE_STALE_MS): boolean {
  return lastWsAt != null && now - lastWsAt < staleMs;
}

/** Visual card/list price. XAU main is always V1 spot; Bitget never masquerades as spot. */
export function visualCardPrice(args: {
  id: AssetId;
  live: number | null | undefined;
  snapshotPrice: number | null | undefined;
  snapshotSpot: number | null | undefined;
}): { main: number | null; proxy: number | null } {
  const live = args.live != null && args.live > 0 ? args.live : null;
  if (args.id === "XAUUSD") {
    const spot = args.snapshotSpot != null && args.snapshotSpot > 0 ? args.snapshotSpot : null;
    const snap = args.snapshotPrice != null && args.snapshotPrice > 0 ? args.snapshotPrice : null;
    return { main: spot ?? snap, proxy: live };
  }
  const snap = args.snapshotPrice != null && args.snapshotPrice > 0 ? args.snapshotPrice : null;
  return { main: live ?? snap, proxy: null };
}

export function visualDelayed(source: LiveQuoteSource | undefined, hasPrice: boolean): boolean {
  if (!hasPrice) return true;
  return source !== "ws";
}
