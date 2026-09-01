import type { Candle } from "../trading/types";
import { slotOpenSec } from "../watch/identity";

export type TapeTf = "15m" | "1h" | "4h";
export type TapeRole = "lookback" | "forward";

export interface TapeBar {
  tf: TapeTf;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  role: TapeRole;
}

const STEP: Record<TapeTf, number> = {
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
};

export function finiteBar(c: Candle): boolean {
  return [c.time, c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0);
}

export function toTapeBar(c: Candle, tf: TapeTf, role: TapeRole): TapeBar | null {
  if (!finiteBar(c)) return null;
  return {
    tf,
    t: c.time,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: Number.isFinite(c.volume) ? c.volume : null,
    role,
  };
}

/** Decision 15M bar open. openedSlot is the 15M close unix seconds. */
export function decisionOpenSec(openedSlot: number): number {
  return slotOpenSec(openedSlot);
}

export function lookbackOf(candles: Candle[], tf: TapeTf, openedSlot: number): TapeBar[] {
  const open = decisionOpenSec(openedSlot);
  const out: TapeBar[] = [];
  for (const c of candles) {
    if (c.time > open) continue;
    const row = toTapeBar(c, tf, "lookback");
    if (row) out.push(row);
  }
  return out.sort((a, b) => a.t - b.t);
}

export function forwardOf(candles: Candle[], tf: TapeTf, openedSlot: number): TapeBar[] {
  const open = decisionOpenSec(openedSlot);
  const out: TapeBar[] = [];
  for (const c of candles) {
    if (c.time <= open) continue;
    const row = toTapeBar(c, tf, "forward");
    if (row) out.push(row);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Expected opens between first and last stored bar. Missing → gaps, never filled. */
export function detectGaps(times: number[], tf: TapeTf): number[] {
  if (times.length < 2) return [];
  const step = STEP[tf];
  const sorted = [...times].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    for (let t = prev + step; t < next; t += step) gaps.push(t);
  }
  return gaps;
}

export function uniqueByTime(bars: TapeBar[]): TapeBar[] {
  const seen = new Set<number>();
  const out: TapeBar[] = [];
  for (const b of bars) {
    if (seen.has(b.t)) continue;
    seen.add(b.t);
    out.push(b);
  }
  return out;
}
