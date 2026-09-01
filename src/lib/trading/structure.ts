import type { Candle, Trend } from "./types";

const SWING = 2;

export function swingHighs(candles: Candle[]): { index: number; price: number }[] {
  const out: { index: number; price: number }[] = [];
  for (let i = SWING; i < candles.length - SWING; i++) {
    const p = candles[i]!.high;
    let ok = true;
    for (let j = 1; j <= SWING; j++) {
      if (p <= candles[i - j]!.high || p <= candles[i + j]!.high) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ index: i, price: p });
  }
  return out;
}

export function swingLows(candles: Candle[]): { index: number; price: number }[] {
  const out: { index: number; price: number }[] = [];
  for (let i = SWING; i < candles.length - SWING; i++) {
    const p = candles[i]!.low;
    let ok = true;
    for (let j = 1; j <= SWING; j++) {
      if (p >= candles[i - j]!.low || p >= candles[i + j]!.low) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ index: i, price: p });
  }
  return out;
}

export function clusterLevels(
  prices: number[],
  atr: number | null,
  lastPrice: number,
): number[] {
  if (prices.length === 0) return [];
  const tol = Math.max(atr ? atr * 0.35 : lastPrice * 0.0015, lastPrice * 0.0006);
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const p of sorted) {
    const lastCluster = clusters[clusters.length - 1];
    if (!lastCluster) {
      clusters.push([p]);
      continue;
    }
    const mean = lastCluster.reduce((s, x) => x + s, 0) / lastCluster.length;
    if (Math.abs(p - mean) <= tol) lastCluster.push(p);
    else clusters.push([p]);
  }
  return clusters
    .map((c) => c.reduce((s, x) => s + x, 0) / c.length)
    .sort((a, b) => a - b);
}

export function extractLevels(candles: Candle[], atr: number | null): LevelsLike {
  const last = candles[candles.length - 1];
  if (!last) return { supports: [], resistances: [] };
  const lookback = candles.slice(-80);
  const highs = swingHighs(lookback).map((s) => s.price);
  const lows = swingLows(lookback).map((s) => s.price);
  const clusteredHigh = clusterLevels(highs, atr, last.close);
  const clusteredLow = clusterLevels(lows, atr, last.close);
  const supports = clusteredLow
    .filter((p) => p < last.close)
    .slice(-3)
    .reverse();
  const resistances = clusteredHigh.filter((p) => p > last.close).slice(0, 3);
  return { supports, resistances };
}

type LevelsLike = { supports: number[]; resistances: number[] };

export function marketStructure(candles: Candle[]): { trend: Trend; label: string } {
  const highs = swingHighs(candles);
  const lows = swingLows(candles);
  if (highs.length < 2 || lows.length < 2) {
    return { trend: "lateral", label: "Estructura insuficiente (pocos swings)" };
  }
  const h1 = highs[highs.length - 2]!.price;
  const h2 = highs[highs.length - 1]!.price;
  const l1 = lows[lows.length - 2]!.price;
  const l2 = lows[lows.length - 1]!.price;
  const hh = h2 > h1;
  const hl = l2 > l1;
  const lh = h2 < h1;
  const ll = l2 < l1;
  if (hh && hl) return { trend: "alcista", label: "Máximos y mínimos crecientes" };
  if (lh && ll) return { trend: "bajista", label: "Máximos y mínimos decrecientes" };
  return { trend: "lateral", label: "Swings mixtos, sin secuencia clara" };
}

export function emaTrend(
  price: number,
  ema20: number | null,
  ema50: number | null,
  ema200: number | null,
): { bias: number; label: string } {
  const parts: string[] = [];
  let bias = 0;
  if (ema20 != null) {
    if (price > ema20) {
      bias += 1;
      parts.push("precio > EMA20");
    } else {
      bias -= 1;
      parts.push("precio < EMA20");
    }
  }
  if (ema20 != null && ema50 != null) {
    if (ema20 > ema50) {
      bias += 1;
      parts.push("EMA20 > EMA50");
    } else {
      bias -= 1;
      parts.push("EMA20 < EMA50");
    }
  }
  if (ema50 != null && ema200 != null) {
    if (ema50 > ema200) {
      bias += 1;
      parts.push("EMA50 > EMA200");
    } else {
      bias -= 1;
      parts.push("EMA50 < EMA200");
    }
  }
  if (ema200 != null) {
    if (price > ema200) {
      bias += 0.5;
      parts.push("precio > EMA200");
    } else {
      bias -= 0.5;
      parts.push("precio < EMA200");
    }
  }
  return { bias, label: parts.join(", ") || "EMAs incompletas" };
}

export interface BosEvent {
  dir: "buy" | "sell";
  level: number;
  index: number;
}

export interface StructureState {
  bias: Trend;
  bos: BosEvent | null;
  choch: BosEvent | null;
  lastSwingHigh: { index: number; price: number } | null;
  lastSwingLow: { index: number; price: number } | null;
  invalidation: number | null;
  tp1: number | null;
  tp2: number | null;
  majorLow: number | null;
  majorHigh: number | null;
  label: string;
}

/**
 * Sesgo por BOS/CHOCH de CIERRES. Un par mixto no borra un BOS vigente.
 * EMA no participa.
 */
export function detectBosChoch(candles: Candle[]): StructureState {
  const highs = swingHighs(candles);
  const lows = swingLows(candles);
  const lastH = highs.at(-1) ?? null;
  const lastL = lows.at(-1) ?? null;
  const majorLow = lows.length ? Math.min(...lows.slice(-6).map((s) => s.price)) : null;
  const majorHigh = highs.length ? Math.max(...highs.slice(-6).map((s) => s.price)) : null;

  let bos: BosEvent | null = null;
  let choch: BosEvent | null = null;
  let postBosHigh: { index: number; price: number } | null = null;
  let postBosLow: { index: number; price: number } | null = null;
  let capHigh: { index: number; price: number } | null = null;
  let capLow: { index: number; price: number } | null = null;

  const hiAt = (i: number) => {
    for (let k = highs.length - 1; k >= 0; k--) {
      if (highs[k]!.index < i) return highs[k]!;
    }
    return null;
  };
  const loAt = (i: number) => {
    for (let k = lows.length - 1; k >= 0; k--) {
      if (lows[k]!.index < i) return lows[k]!;
    }
    return null;
  };

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i]!.close;
    const lo = loAt(i);
    const hi = hiAt(i);

    if (bos?.dir === "sell") {
      const invHigh = Math.max(
        capHigh?.price ?? -Infinity,
        postBosHigh?.price ?? -Infinity,
      );
      if (Number.isFinite(invHigh) && close > invHigh) {
        choch = { dir: "buy", level: invHigh, index: i };
        bos = { dir: "buy", level: invHigh, index: i };
        capLow = lo;
        capHigh = null;
        postBosHigh = null;
        postBosLow = null;
      }
    } else if (bos?.dir === "buy") {
      const invLow = Math.min(
        capLow?.price ?? Infinity,
        postBosLow?.price ?? Infinity,
      );
      if (Number.isFinite(invLow) && close < invLow) {
        choch = { dir: "sell", level: invLow, index: i };
        bos = { dir: "sell", level: invLow, index: i };
        capHigh = hi;
        capLow = null;
        postBosHigh = null;
        postBosLow = null;
      }
    }

    if (lo && close < lo.price) {
      if (bos?.dir !== "sell" || lo.price < bos.level) {
        bos = { dir: "sell", level: lo.price, index: i };
        if (hi) capHigh = hi;
        capLow = null;
        postBosHigh = null;
        postBosLow = { index: lo.index, price: lo.price };
      }
    }
    if (hi && close > hi.price) {
      if (bos?.dir !== "buy" || hi.price > bos.level) {
        if (bos?.dir !== "sell") {
          bos = { dir: "buy", level: hi.price, index: i };
          if (lo) capLow = lo;
          capHigh = null;
          postBosLow = null;
          postBosHigh = { index: hi.index, price: hi.price };
        }
      }
    }

    if (bos) {
      for (const h of highs) {
        if (h.index > bos.index && h.index <= i) {
          if (!postBosHigh || h.price > postBosHigh.price) postBosHigh = h;
        }
      }
      for (const l of lows) {
        if (l.index > bos.index && l.index <= i) {
          if (!postBosLow || l.price < postBosLow.price) postBosLow = l;
        }
      }
    }
  }

  const bias: Trend = bos ? (bos.dir === "sell" ? "bajista" : "alcista") : "lateral";
  const invalidation =
    bos?.dir === "sell"
      ? maxPrice(capHigh?.price, postBosHigh?.price, lastH?.price)
      : bos?.dir === "buy"
        ? minPrice(capLow?.price, postBosLow?.price, lastL?.price)
        : null;

  const tp1 = bos?.level ?? null;
  let tp2: number | null = null;
  if (bos?.dir === "sell") {
    const below = lows.map((s) => s.price).filter((p) => p < bos!.level);
    below.sort((a, b) => b - a);
    tp2 = below[0] ?? majorLow;
    if (tp2 === tp1) tp2 = below[1] ?? null;
  } else if (bos?.dir === "buy") {
    const above = highs.map((s) => s.price).filter((p) => p > bos!.level);
    above.sort((a, b) => a - b);
    tp2 = above[0] ?? majorHigh;
    if (tp2 === tp1) tp2 = above[1] ?? null;
  }

  const chochAfter = choch && bos && choch.index > bos.index;
  const label = bos
    ? bos.dir === "sell"
      ? `BOS bajista local en ${bos.level.toFixed(2)}${chochAfter && choch?.dir === "buy" ? " · CHOCH alcista posterior" : ""}`
      : `BOS alcista local en ${bos.level.toFixed(2)}${chochAfter && choch?.dir === "sell" ? " · CHOCH bajista posterior" : ""}`
    : "Sin BOS confirmado por cierre";

  return {
    bias,
    bos,
    choch,
    lastSwingHigh: lastH,
    lastSwingLow: lastL,
    invalidation,
    tp1,
    tp2,
    majorLow,
    majorHigh,
    label,
  };
}

function maxPrice(...vals: Array<number | null | undefined>): number | null {
  const n = vals.filter((v): v is number => v != null && Number.isFinite(v));
  return n.length ? Math.max(...n) : null;
}

function minPrice(...vals: Array<number | null | undefined>): number | null {
  const n = vals.filter((v): v is number => v != null && Number.isFinite(v));
  return n.length ? Math.min(...n) : null;
}

export function meanVolume(candles: Candle[], endExclusive: number, lookback = 20): number | null {
  const start = Math.max(0, endExclusive - lookback);
  const slice = candles.slice(start, endExclusive);
  const vols = slice.map((c) => c.volume).filter((v): v is number => v != null && v > 0);
  if (!vols.length) return null;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

export function overlapsZone(
  candle: Candle,
  zone: { low: number; high: number },
): boolean {
  return candle.high >= zone.low && candle.low <= zone.high;
}

export function nearLevel(
  price: number,
  levels: number[],
  atr: number | null,
  ref: number,
): boolean {
  const tol = Math.max(atr ? atr * 0.3 : ref * 0.0015, ref * 0.0015);
  return levels.some((p) => Math.abs(p - price) <= tol);
}
