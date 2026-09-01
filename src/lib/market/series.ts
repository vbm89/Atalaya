import type { Candle } from "@/lib/trading/types";

export interface TfFetch {
  candles: Candle[];
  source: string;
  error: string | null;
}

export interface QuoteFetch {
  price: number | null;
  dayChangePct: number | null;
  marketTime: string | null;
  source: string;
  error: string | null;
}

export function emptyTf(source: string, error: string): TfFetch {
  return { candles: [], source, error };
}

export function emptyQuote(source: string, error: string): QuoteFetch {
  return {
    price: null,
    dayChangePct: null,
    marketTime: null,
    source,
    error,
  };
}

export function lastBarIso(candles: Candle[]): string | null {
  const t = candles.at(-1)?.time;
  if (t == null || !Number.isFinite(t)) return null;
  return new Date(t * 1000).toISOString();
}

export function finiteCandle(c: Candle): boolean {
  return (
    Number.isFinite(c.time) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close) &&
    c.high >= c.low
  );
}
