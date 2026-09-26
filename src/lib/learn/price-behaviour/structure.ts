import { PARAMS } from "./params.ts";
import type { Bar, StructureView, Swing } from "./types.ts";

export function confirmedSwings(bars: readonly Bar[], endInclusive: number, radius = PARAMS.swingRadius): Swing[] {
  const out: Swing[] = [];
  const last = endInclusive - radius;
  for (let s = radius; s <= last; s++) {
    const mid = bars[s]!;
    let high = true;
    let low = true;
    for (let k = s - radius; k <= s + radius; k++) {
      if (k === s) continue;
      const other = bars[k]!;
      if (other.h >= mid.h) high = false;
      if (other.l <= mid.l) low = false;
    }
    if (high) out.push({ index: s, price: mid.h, kind: "high", confirmIndex: s + radius });
    if (low) out.push({ index: s, price: mid.l, kind: "low", confirmIndex: s + radius });
  }
  return out;
}

function lastOf(swings: readonly Swing[], kind: Swing["kind"], skip = 0): Swing | null {
  let seen = 0;
  for (let i = swings.length - 1; i >= 0; i--) {
    if (swings[i]!.kind !== kind) continue;
    if (seen === skip) return swings[i]!;
    seen += 1;
  }
  return null;
}

function windowExtreme(bars: readonly Bar[], i: number, lookback: number, side: "high" | "low"): number | null {
  const from = Math.max(0, i - lookback);
  if (i - from < 2) return null;
  let v = side === "high" ? -Infinity : Infinity;
  for (let k = from; k < i; k++) {
    const b = bars[k]!;
    v = side === "high" ? Math.max(v, b.h) : Math.min(v, b.l);
  }
  return Number.isFinite(v) ? v : null;
}

/** Estructura solo con velas cerradas hasta i. El swing se confirma `radius` velas después. */
export function structureAt(bars: readonly Bar[], i: number): StructureView {
  const swings = confirmedSwings(bars, i);
  const lastHigh = lastOf(swings, "high");
  const prevHigh = lastOf(swings, "high", 1);
  const lastLow = lastOf(swings, "low");
  const prevLow = lastOf(swings, "low", 1);
  const hh = lastHigh != null && prevHigh != null && lastHigh.price > prevHigh.price;
  const lh = lastHigh != null && prevHigh != null && lastHigh.price < prevHigh.price;
  const hl = lastLow != null && prevLow != null && lastLow.price > prevLow.price;
  const ll = lastLow != null && prevLow != null && lastLow.price < prevLow.price;
  const close = bars[i]!.c;
  return {
    swings,
    hh,
    hl,
    lh,
    ll,
    lastHigh,
    prevHigh,
    lastLow,
    prevLow,
    recentHigh: windowExtreme(bars, i, PARAMS.structureLookback, "high"),
    recentLow: windowExtreme(bars, i, PARAMS.structureLookback, "low"),
    rangeHigh: windowExtreme(bars, i, PARAMS.rangeLookback, "high"),
    rangeLow: windowExtreme(bars, i, PARAMS.rangeLookback, "low"),
    bosUp: lastHigh != null && close > lastHigh.price,
    bosDown: lastLow != null && close < lastLow.price,
  };
}
