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

const EXCHANGE_WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall clock in an IANA zone. DST is the zone's, not a fixed UTC offset. */
export function exchangeCivilTime(
  now: number,
  timeZone: string,
): { weekday: number; minutes: number } | null {
  if (!Number.isFinite(now)) return null;
  const bag: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now))) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const weekday = EXCHANGE_WEEKDAY[bag.weekday ?? ""];
  let hour = Number(bag.hour);
  const minute = Number(bag.minute);
  if (weekday == null || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour === 24) hour = 0;
  return { weekday, minutes: hour * 60 + minute };
}

/**
 * Shared CME Globex week for NYMEX CL and COMEX GC, in America/Chicago.
 * Sunday 17:00 CT inclusive → Friday 16:00 CT exclusive.
 * Monday–Thursday maintenance [16:00, 17:00) CT.
 * Not a fixed UTC window: 16:00 CT is 21:00 UTC in summer and 22:00 UTC in winter.
 * Holidays are not modelled. Does not include the Nasdaq 16:15–16:30 ET halt.
 */
export function isCmeSessionOpen(now = Date.now()): boolean {
  const t = exchangeCivilTime(now, "America/Chicago");
  if (!t) return false;
  if (t.weekday === 6) return false;
  if (t.weekday === 0) return t.minutes >= 17 * 60;
  if (t.weekday === 5) return t.minutes < 16 * 60;
  if (t.minutes >= 16 * 60 && t.minutes < 17 * 60) return false;
  return true;
}
