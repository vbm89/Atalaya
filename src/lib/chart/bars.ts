import type { Candle } from "../trading/types";
import type { ChartTf } from "./types";

export function mergeBar(prev: Candle[], next: Candle): Candle[] {
  if (!prev.length) return [next];
  const last = prev[prev.length - 1]!;
  if (next.time === last.time) {
    const out = prev.slice();
    out[out.length - 1] = next;
    return out;
  }
  if (next.time > last.time) return [...prev, next];
  return prev;
}

/** Mutates `prev` in place. Hot path for ticks — no copy of the series. */
export function patchLastBar(prev: Candle[], next: Candle): boolean {
  if (!prev.length) {
    prev.push(next);
    return true;
  }
  const last = prev[prev.length - 1]!;
  if (next.time === last.time) {
    prev[prev.length - 1] = next;
    return false;
  }
  if (next.time > last.time) {
    prev.push(next);
    return true;
  }
  return false;
}

export function foldLiveLast(hist: Candle[], liveLast: Candle | undefined): Candle[] {
  if (!hist.length) return liveLast ? [liveLast] : [];
  if (!liveLast) return hist;
  const histLast = hist[hist.length - 1]!;
  if (liveLast.time > histLast.time) return [...hist, liveLast];
  if (liveLast.time === histLast.time) return [...hist.slice(0, -1), liveLast];
  return hist;
}

export function sameOhlc(a: Candle, b: Candle): boolean {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

export function tfSeconds(tf: ChartTf): number {
  switch (tf) {
    case "1m":
      return 60;
    case "5m":
      return 300;
    case "15m":
      return 900;
    case "30m":
      return 1800;
    case "1h":
      return 3600;
    case "4h":
      return 14400;
    case "1d":
      return 86400;
    case "1w":
      return 604800;
    case "1M":
      return 2_592_000;
  }
}

/**
 * Aplica un tick real sobre la vela abierta, mutándola.
 * No crea velas ni rellena huecos. Devuelve true si el OHLC cambió.
 */
export function applyTradeInPlace(
  last: Candle,
  price: number,
  tradeTime: number,
  tfSec: number,
): boolean {
  if (!(price > 0) || !Number.isFinite(price) || !Number.isFinite(tradeTime)) return false;
  if (!(tfSec > 0) || !Number.isFinite(last.time)) return false;
  if (tradeTime < last.time) return false;
  if (tradeTime >= last.time + tfSec) return false;
  if (price === last.close && price <= last.high && price >= last.low) return false;
  if (price > last.high) last.high = price;
  if (price < last.low) last.low = price;
  last.close = price;
  return true;
}

export function applyTradeToLast(
  last: Candle,
  price: number,
  tradeTime: number,
  tfSec: number,
): Candle | null {
  if (!(price > 0) || !Number.isFinite(price) || !Number.isFinite(tradeTime)) return null;
  if (!(tfSec > 0) || !Number.isFinite(last.time)) return null;
  if (tradeTime < last.time) return null;
  if (tradeTime >= last.time + tfSec) return null;
  if (price === last.close && price <= last.high && price >= last.low) return last;
  return {
    ...last,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    close: price,
  };
}

/**
 * Fold an exchange kline onto the live open bar.
 * Never rewinds close/high/low past a newer real trade. Mutates `last`.
 */
export function mergeKlineIntoOpen(
  last: Candle,
  kline: Candle,
  lastTradeTs: number,
  klineEventTs: number,
): boolean {
  if (kline.time !== last.time) return false;
  let changed = false;
  if (kline.open !== last.open) {
    last.open = kline.open;
    changed = true;
  }
  if (kline.high > last.high) {
    last.high = kline.high;
    changed = true;
  }
  if (kline.low < last.low && kline.low > 0) {
    last.low = kline.low;
    changed = true;
  }
  if (kline.volume != null && kline.volume !== last.volume) {
    last.volume = kline.volume;
    changed = true;
  }
  if (klineEventTs >= lastTradeTs && kline.close !== last.close) {
    last.close = kline.close;
    changed = true;
  }
  return changed;
}
