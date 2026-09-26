/**
 * Primitivas causales. Toda lectura en el índice i usa solo bars[0..i].
 * Misma semántica que shadow-discovery-primitives de Atalaya (no se importa V1).
 */
import { ATR_PERIOD, RANGE_LOOKBACK, SMA_PERIOD, SWING_RADIUS } from "./constants.ts";
import type { ShadowBar } from "./types.ts";

export function ohlcValid(b: Pick<ShadowBar, "o" | "h" | "l" | "c">): boolean {
  if (![b.o, b.h, b.l, b.c].every((n) => Number.isFinite(n))) return false;
  if (b.h < b.l) return false;
  if (b.h < Math.max(b.o, b.c)) return false;
  if (b.l > Math.min(b.o, b.c)) return false;
  return true;
}

export function trueRange(prevClose: number, bar: ShadowBar): number {
  return Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
}

/** ATR Wilder sobre el prefijo cerrado que termina en endInclusive. */
export function atrAt(
  bars: readonly ShadowBar[],
  endInclusive: number,
  period = ATR_PERIOD,
): number | null {
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

export interface ConfirmedSwing {
  index: number;
  price: number;
  kind: "high" | "low";
  confirmIndex: number;
}

export function confirmedSwings(
  bars: readonly ShadowBar[],
  endInclusive: number,
  radius = SWING_RADIUS,
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

export function rangeAt(
  bars: readonly ShadowBar[],
  i: number,
  lookback = RANGE_LOOKBACK,
): { high: number; low: number } | null {
  if (i < lookback) return null;
  const slice = bars.slice(i - lookback, i);
  return { high: Math.max(...slice.map((b) => b.h)), low: Math.min(...slice.map((b) => b.l)) };
}

export function displacementAt(bars: readonly ShadowBar[], i: number, atr: number | null): boolean {
  if (atr == null || atr <= 0) return false;
  const b = bars[i]!;
  return Math.abs(b.c - b.o) >= atr;
}

export function compressionAt(bars: readonly ShadowBar[], i: number, atr: number | null): boolean {
  if (atr == null || atr <= 0 || i < 1) return false;
  return bars[i]!.h - bars[i]!.l < 0.5 * atr;
}

export function smaAt(bars: readonly ShadowBar[], i: number, period = SMA_PERIOD): number | null {
  if (i + 1 < period) return null;
  let s = 0;
  for (let k = i - period + 1; k <= i; k++) s += bars[k]!.c;
  return s / period;
}

/** Percentil de ATR[i] respecto a ATR[i-lookback+1..i], solo pasado. */
export function atrPercentileAt(
  atrs: readonly (number | null)[],
  i: number,
  lookback: number,
): number | null {
  const cur = atrs[i];
  if (cur == null) return null;
  const window: number[] = [];
  const from = Math.max(0, i - lookback + 1);
  for (let k = from; k <= i; k++) {
    const v = atrs[k];
    if (v != null) window.push(v);
  }
  if (window.length < 8) return null;
  const below = window.filter((v) => v <= cur).length;
  return below / window.length;
}

export function compressionRunLength(
  bars: readonly ShadowBar[],
  atrs: readonly (number | null)[],
  i: number,
): number {
  let n = 0;
  for (let k = i; k >= 0; k--) {
    if (compressionAt(bars, k, atrs[k] ?? null)) n += 1;
    else break;
  }
  return n;
}

export function precomputeAtr(bars: readonly ShadowBar[]): (number | null)[] {
  const atrs: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) atrs[i] = atrAt(bars, i);
  return atrs;
}
