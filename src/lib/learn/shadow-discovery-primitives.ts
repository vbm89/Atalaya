/**
 * Independent Shadow primitives. Do not import V1 engine/signals/structure/risk.
 * Every calculation at index i uses only bars[0..i] (the bar i is closed).
 */
import {
  DISCOVERY_ATR_PERIOD,
  DISCOVERY_RANGE_LOOKBACK,
  DISCOVERY_SWING_RADIUS,
  type DiscoveryBar,
} from "./shadow-discovery-types";

export function trueRange(prevClose: number, bar: DiscoveryBar): number {
  return Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
}

/** Wilder ATR on the closed prefix ending at `endInclusive`. */
export function atrAt(bars: readonly DiscoveryBar[], endInclusive: number, period = DISCOVERY_ATR_PERIOD): number | null {
  if (endInclusive < period) return null;
  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += trueRange(bars[i - 1]!.c, bars[i]!);
  }
  let atr = trSum / period;
  for (let i = period + 1; i <= endInclusive; i++) {
    atr = (atr * (period - 1) + trueRange(bars[i - 1]!.c, bars[i]!)) / period;
  }
  return atr > 0 ? atr : null;
}

export function volumeRatioAt(bars: readonly DiscoveryBar[], i: number, lookback = 20): number | null {
  const v = bars[i]?.v;
  if (v == null || v <= 0) return null;
  const prev = bars.slice(Math.max(0, i - lookback), i).map((b) => b.v).filter((x): x is number => x != null && x > 0);
  if (!prev.length) return null;
  const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
  return avg > 0 ? v / avg : null;
}

export interface ConfirmedSwing {
  index: number;
  price: number;
  kind: "high" | "low";
  /** Bar index at which the swing is confirmed (causal). */
  confirmIndex: number;
}

/**
 * Fractal swings of radius R. A swing at s is confirmed only when bar s+R is closed,
 * i.e. when endInclusive >= s+R. No lookahead past endInclusive.
 */
export function confirmedSwings(
  bars: readonly DiscoveryBar[],
  endInclusive: number,
  radius = DISCOVERY_SWING_RADIUS,
): ConfirmedSwing[] {
  const out: ConfirmedSwing[] = [];
  const lastConfirmable = endInclusive - radius;
  for (let s = radius; s <= lastConfirmable; s++) {
    const mid = bars[s]!;
    let high = true;
    let low = true;
    for (let k = s - radius; k <= s + radius; k++) {
      if (k === s) continue;
      const o = bars[k]!;
      if (o.h >= mid.h) high = false;
      if (o.l <= mid.l) low = false;
    }
    if (high) out.push({ index: s, price: mid.h, kind: "high", confirmIndex: s + radius });
    if (low) out.push({ index: s, price: mid.l, kind: "low", confirmIndex: s + radius });
  }
  return out;
}

export function lastSwing(swings: readonly ConfirmedSwing[], kind: "high" | "low"): ConfirmedSwing | null {
  for (let i = swings.length - 1; i >= 0; i--) {
    if (swings[i]!.kind === kind) return swings[i]!;
  }
  return null;
}

export function rangeAt(bars: readonly DiscoveryBar[], i: number, lookback = DISCOVERY_RANGE_LOOKBACK): {
  high: number;
  low: number;
} | null {
  if (i < lookback) return null;
  const slice = bars.slice(i - lookback, i);
  return { high: Math.max(...slice.map((b) => b.h)), low: Math.min(...slice.map((b) => b.l)) };
}

export function displacementAt(bars: readonly DiscoveryBar[], i: number, atr: number | null): boolean {
  if (atr == null || atr <= 0) return false;
  const b = bars[i]!;
  return Math.abs(b.c - b.o) >= atr;
}

/** Bullish FVG: bar[i-2].h < bar[i].l. Bearish: bar[i-2].l > bar[i].h. Created at i. */
export function fvgAt(bars: readonly DiscoveryBar[], i: number): { dir: "buy" | "sell"; low: number; high: number } | null {
  if (i < 2) return null;
  const a = bars[i - 2]!;
  const c = bars[i]!;
  if (a.h < c.l) return { dir: "buy", low: a.h, high: c.l };
  if (a.l > c.h) return { dir: "sell", low: c.h, high: a.l };
  return null;
}

export function compressionAt(bars: readonly DiscoveryBar[], i: number, atr: number | null): boolean {
  if (atr == null || atr <= 0 || i < 1) return false;
  return bars[i]!.h - bars[i]!.l < 0.5 * atr;
}
