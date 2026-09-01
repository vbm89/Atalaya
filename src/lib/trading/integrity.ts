import type { Candle, Timeframe } from "./types";

export const MIN_BARS: Record<Timeframe, number> = {
  "5m": 60,
  "15m": 60,
  "1h": 60,
  "4h": 40,
};

export const TF_STEP_SEC: Record<Timeframe, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
};

/** Last bar is stale if older than interval + grace. Forming bars are not stale. */
export const STALE_AFTER_MS: Record<Timeframe, number> = {
  "5m": 15 * 60 * 1000,
  "15m": 35 * 60 * 1000,
  "1h": 90 * 60 * 1000,
  "4h": 5 * 60 * 60 * 1000,
};

const MAX_GAPS = 15;

export function candleAgeMs(lastBarAt: string | null, now: number): number | null {
  if (!lastBarAt) return null;
  const t = Date.parse(lastBarAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

export function isTfStale(tf: Timeframe, lastBarAt: string | null, now: number): boolean {
  const age = candleAgeMs(lastBarAt, now);
  if (age == null) return true;
  return age > STALE_AFTER_MS[tf];
}

export function countGaps(candles: Candle[], tf: Timeframe): number {
  const step = TF_STEP_SEC[tf];
  let missing = 0;
  for (let i = 1; i < candles.length; i++) {
    const d = (candles[i]!.time - candles[i - 1]!.time) / step;
    if (d > 1.51) missing += Math.round(d - 1);
  }
  return missing;
}

export function hasExcessiveGaps(candles: Candle[], tf: Timeframe): boolean {
  return countGaps(candles, tf) > MAX_GAPS;
}

/**
 * CME/COMEX/NYMEX Globex: Sun 22:00 UTC – Fri 21:00 UTC,
 * daily halt 21:00–22:00 UTC. Saturday always closed.
 * Holidays are not modelled — extra closed hours only make us more conservative.
 */
export function isCmeSessionOpen(now = Date.now()): boolean {
  const d = new Date(now);
  const dow = d.getUTCDay();
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (dow === 6) return false;
  if (dow === 0) return minutes >= 22 * 60;
  if (dow === 5) return minutes < 21 * 60;
  if (minutes >= 21 * 60 && minutes < 22 * 60) return false;
  return true;
}
