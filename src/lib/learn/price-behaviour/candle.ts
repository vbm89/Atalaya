import { PARAMS } from "./params.ts";
import type { Bar, CandleView } from "./types.ts";

export function ohlcValid(b: Bar): boolean {
  if (![b.o, b.h, b.l, b.c].every((n) => Number.isFinite(n))) return false;
  if (b.h < b.l) return false;
  if (b.h < Math.max(b.o, b.c) - 1e-9) return false;
  if (b.l > Math.min(b.o, b.c) + 1e-9) return false;
  return true;
}

export function trueRange(prevClose: number, bar: Bar): number {
  return Math.max(bar.h - bar.l, Math.abs(bar.h - prevClose), Math.abs(bar.l - prevClose));
}

/** Wilder ATR del prefijo cerrado que termina en endInclusive. */
export function atrAt(bars: readonly Bar[], endInclusive: number, period = PARAMS.atrPeriod): number | null {
  if (endInclusive < period) return null;
  let trSum = 0;
  for (let i = 1; i <= period; i++) trSum += trueRange(bars[i - 1]!.c, bars[i]!);
  let atr = trSum / period;
  for (let i = period + 1; i <= endInclusive; i++) {
    atr = (atr * (period - 1) + trueRange(bars[i - 1]!.c, bars[i]!)) / period;
  }
  return atr > 0 ? atr : null;
}

export function emaAt(bars: readonly Bar[], endInclusive: number, period = PARAMS.emaPeriod): number | null {
  if (endInclusive < period - 1) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += bars[i]!.c;
  let ema = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i <= endInclusive; i++) ema = bars[i]!.c * k + ema * (1 - k);
  return ema;
}

export function candleAt(bars: readonly Bar[], i: number, atr: number | null): CandleView | null {
  const bar = bars[i];
  if (!bar || !ohlcValid(bar)) return null;
  const prev = i > 0 ? bars[i - 1]! : bar;
  const range = bar.h - bar.l;
  const body = Math.abs(bar.c - bar.o);
  const upper = bar.h - Math.max(bar.o, bar.c);
  const lower = Math.min(bar.o, bar.c) - bar.l;
  const closeLocation = range > 0 ? (bar.c - bar.l) / range : 0.5;
  const tr = i > 0 ? trueRange(prev.c, bar) : range;
  const rangeAtr = atr != null && atr > 0 ? range / atr : null;
  const tags: string[] = [];
  if (rangeAtr != null && rangeAtr >= PARAMS.displacementRangeAtr) tags.push("LARGE_RANGE");
  if (rangeAtr != null && rangeAtr <= 0.5) tags.push("SMALL_RANGE");
  if (range > 0 && body / range >= PARAMS.displacementBodyFrac && rangeAtr != null && rangeAtr >= 1) tags.push("BODY_EXPANSION");
  if (range > 0 && upper / range >= PARAMS.rejectionWickFrac) tags.push("UPPER_REJECTION");
  if (range > 0 && lower / range >= PARAMS.rejectionWickFrac) tags.push("LOWER_REJECTION");
  if (closeLocation >= PARAMS.closeExtreme) tags.push("CLOSE_AT_HIGH");
  if (closeLocation <= 1 - PARAMS.closeExtreme) tags.push("CLOSE_AT_LOW");
  if (i > 0 && bar.h <= prev.h && bar.l >= prev.l) tags.push("INSIDE_BAR");
  if (i > 0 && bar.h >= prev.h && bar.l <= prev.l && range > prev.h - prev.l) tags.push("OUTSIDE_BAR");
  return {
    range,
    body,
    bodyFrac: range > 0 ? body / range : 0,
    upperWick: upper,
    lowerWick: lower,
    closeLocation,
    trueRange: tr,
    rangeAtr,
    tags,
  };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
