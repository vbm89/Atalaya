import type { AssetId, SetupProposal, SetupState } from "../trading/types";
import { lastBarCloseMs, WATCH_STEP_SEC } from "./schedule";

/** Unix seconds of the 15M close this tick belongs to (UTC). */
export function slotSecFromNow(nowMs: number): number {
  return lastBarCloseMs(nowMs) / 1000;
}

export function slotOpenSec(slotSec: number): number {
  return slotSec - WATCH_STEP_SEC;
}

export function levelsKey(setup: SetupProposal, digits: number): string {
  const f = (n: number) => n.toFixed(digits);
  const tp2 = setup.takeProfit2 == null ? setup.takeProfit1 : setup.takeProfit2;
  return [
    setup.direction,
    setup.kind,
    f(setup.zone.low),
    f(setup.zone.high),
    f(setup.stopLoss),
    f(setup.takeProfit1),
    f(tp2),
  ].join("|");
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable id: asset + opening slot + hash of levels. Not a live signal. */
export function episodeId(assetId: AssetId, openedSlot: number, key: string): string {
  return `${assetId}-${openedSlot}-${fnv1a(key)}`;
}

export function isLiveState(state: SetupState): boolean {
  return state === "map" || state === "pending" || state === "entry";
}

export interface LevelFields {
  direction: "buy" | "sell";
  kind: string;
  zoneLow: number;
  zoneHigh: number;
  sl: number;
  tp1: number;
  tp2: number | null;
}

/**
 * Same opportunity, not a new one. ATR can nudge SL by a few ticks between
 * 15M closes without the zone changing. A real new setup moves the zone.
 */
export function sameOpportunity(prev: LevelFields, setup: SetupProposal, digits: number): boolean {
  if (prev.direction !== setup.direction || prev.kind !== setup.kind) return false;
  const tp2 = setup.takeProfit2 == null ? setup.takeProfit1 : setup.takeProfit2;
  const prevTp2 = prev.tp2 == null ? prev.tp1 : prev.tp2;
  const pairs: Array<[number, number]> = [
    [prev.zoneLow, setup.zone.low],
    [prev.zoneHigh, setup.zone.high],
    [prev.sl, setup.stopLoss],
    [prev.tp1, setup.takeProfit1],
    [prevTp2, tp2],
  ];
  return pairs.every(([a, b]) => nearPrice(a, b, digits));
}

function nearPrice(a: number, b: number, digits: number): boolean {
  if (a.toFixed(digits) === b.toFixed(digits)) return true;
  const tick = 10 ** -digits;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  const eps = Math.max(5 * tick, scale * 1e-5);
  return Math.abs(a - b) <= eps;
}
