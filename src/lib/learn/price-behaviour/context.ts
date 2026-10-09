import { atrAt, emaAt, median, trueRange } from "./candle.ts";
import { PARAMS } from "./params.ts";
import type { AssetId, Bar, ContextView, StructureView } from "./types.ts";

export function sessionId(tSec: number, asset: AssetId): string {
  const d = new Date(tSec * 1000);
  const hh = d.getUTCHours();
  const day = d.toISOString().slice(0, 10);
  if (asset === "BTCUSD") return `${day}-BTC-${Math.floor(hh / 8) * 8}`;
  const name = hh < 7 ? "ASIA" : hh < 13 ? "LONDON" : hh < 21 ? "NEW_YORK" : "OFF";
  return `${day}-${name}`;
}

function atrPercentile(bars: readonly Bar[], i: number, atr: number | null): number | null {
  if (atr == null || i < 5) return null;
  const from = Math.max(1, i - 49);
  let n = 0;
  let below = 0;
  for (let k = from; k <= i; k++) {
    const tr = trueRange(bars[k - 1]!.c, bars[k]!);
    n += 1;
    if (tr <= atr) below += 1;
  }
  return n ? below / n : null;
}

/** Sesgo de un timeframe superior agregado SOLO con cubos ya cerrados en o antes de i. */
export function htfBias(bars: readonly Bar[], i: number, factor: number): ContextView["htf1h"] {
  if (i < factor * 4) return "UNKNOWN";
  let lastEnd = Math.floor(i / factor) * factor + (factor - 1);
  if (lastEnd > i) lastEnd -= factor;
  if (lastEnd < factor - 1) return "UNKNOWN";
  const closes: number[] = [];
  for (let end = factor - 1; end <= lastEnd; end += factor) {
    closes.push(bars[end]!.c);
  }
  if (closes.length < 4) return "UNKNOWN";
  const last = closes[closes.length - 1]!;
  const prev = closes[closes.length - 4]!;
  const atr = atrAt(bars, i);
  if (atr == null || atr <= 0) return "UNKNOWN";
  const diff = (last - prev) / atr;
  if (diff > 0.4) return "UP";
  if (diff < -0.4) return "DOWN";
  return "FLAT";
}

export function contextAt(bars: readonly Bar[], i: number, asset: AssetId, structure: StructureView): ContextView {
  const bar = bars[i]!;
  const atr = atrAt(bars, i);
  const ema = emaAt(bars, i);
  const sid = sessionId(bar.t, asset);
  let sessionHigh: number | null = null;
  let sessionLow: number | null = null;
  const from = Math.max(0, i - 40);
  for (let k = from; k < i; k++) {
    if (sessionId(bars[k]!.t, asset) !== sid) continue;
    sessionHigh = sessionHigh == null ? bars[k]!.h : Math.max(sessionHigh, bars[k]!.h);
    sessionLow = sessionLow == null ? bars[k]!.l : Math.min(sessionLow, bars[k]!.l);
  }
  const dist = (level: number | null, price: number) =>
    atr != null && atr > 0 && level != null ? (price - level) / atr : null;
  const structLevel =
    structure.lastLow && structure.lastHigh
      ? Math.abs(bar.c - structure.lastLow.price) < Math.abs(bar.c - structure.lastHigh.price)
        ? structure.lastLow.price
        : structure.lastHigh.price
      : (structure.lastLow?.price ?? structure.lastHigh?.price ?? null);
  const ranges: number[] = [];
  for (let k = Math.max(1, i - 20); k <= i; k++) ranges.push(bars[k]!.h - bars[k]!.l);
  const med = median(ranges);
  let volatility: ContextView["volatility"] = "UNKNOWN";
  if (atr != null && med != null) {
    const ratio = med / atr;
    volatility = ratio < 0.7 ? "LOW" : ratio > 1.25 ? "HIGH" : "NORMAL";
  }
  const pct = atrPercentile(bars, i, atr);
  return {
    ema,
    atr,
    atrPercentile: pct,
    distStructureAtr: dist(structLevel, bar.c),
    distSessionHighAtr: sessionHigh == null ? null : dist(sessionHigh, bar.c),
    distSessionLowAtr: sessionLow == null ? null : dist(sessionLow, bar.c),
    distRecentHighAtr: dist(structure.recentHigh, bar.c),
    distRecentLowAtr: dist(structure.recentLow, bar.c),
    distEmaAtr: ema == null ? null : dist(ema, bar.c),
    volatility,
    session: sid,
    sessionHigh,
    sessionLow,
    htf1h: htfBias(bars, i, 4),
    htf4h: htfBias(bars, i, 16),
  };
}
