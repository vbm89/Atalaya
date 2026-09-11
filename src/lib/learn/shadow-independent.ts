import type { AssetId } from "../trading/types";

export interface IndependentBar { t: number; o: number; h: number; l: number; c: number; v: number | null }
export interface IndependentCandidate {
  assetId: AssetId;
  strategy: "BREAKOUT_RETEST_15M";
  direction: "buy" | "sell";
  decisionSlot: number;
  entry: number;
  sl: number;
  tp1: number;
  rangeHigh: number;
  rangeLow: number;
  volumeRatio: number | null;
}

const STEP = 900;
const LOOKBACK = 16;
const MIN_RR = 1.5;

function volumeRatio(bars: readonly IndependentBar[], i: number): number | null {
  const values = bars.slice(Math.max(0, i - 20), i).map((b) => b.v).filter((v): v is number => v != null && v > 0);
  const v = bars[i]?.v;
  if (!values.length || v == null || v <= 0) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return avg > 0 ? v / avg : null;
}

/**
 * Research-only independent opportunity detector. It does not use V1 episodes,
 * outcomes, or future candles when deciding. A breakout is followed by a
 * later retest; the candidate is emitted only on the retest candle close.
 */
export function scanBreakoutRetest(assetId: AssetId, input: readonly IndependentBar[]): IndependentCandidate[] {
  const bars = [...input].filter((b) => Number.isFinite(b.t)).sort((a, b) => a.t - b.t);
  const out: IndependentCandidate[] = [];
  for (let i = LOOKBACK + 1; i < bars.length; i += 1) {
    const b = bars[i]!;
    const rangeBars = bars.slice(i - LOOKBACK, i);
    const rangeHigh = Math.max(...rangeBars.map((x) => x.h));
    const rangeLow = Math.min(...rangeBars.map((x) => x.l));
    const vr = volumeRatio(bars, i);
    const breakoutUp = b.c > rangeHigh;
    const breakoutDown = b.c < rangeLow;
    if (!breakoutUp && !breakoutDown) continue;

    for (let j = i + 1; j < Math.min(bars.length, i + 9); j += 1) {
      const r = bars[j]!;
      if (breakoutUp) {
        if (r.l > rangeHigh || r.c <= rangeHigh) continue;
        const entry = r.c;
        const sl = Math.min(r.l, rangeHigh);
        const risk = entry - sl;
        const tp1 = entry + Math.max(risk * MIN_RR, rangeHigh - rangeLow);
        if (risk <= 0 || (tp1 - entry) / risk < MIN_RR) continue;
        out.push({ assetId, strategy: "BREAKOUT_RETEST_15M", direction: "buy", decisionSlot: r.t + STEP, entry, sl, tp1, rangeHigh, rangeLow, volumeRatio: vr });
        break;
      }
      if (breakoutDown) {
        if (r.h < rangeLow || r.c >= rangeLow) continue;
        const entry = r.c;
        const sl = Math.max(r.h, rangeLow);
        const risk = sl - entry;
        const tp1 = entry - Math.max(risk * MIN_RR, rangeHigh - rangeLow);
        if (risk <= 0 || (entry - tp1) / risk < MIN_RR) continue;
        out.push({ assetId, strategy: "BREAKOUT_RETEST_15M", direction: "sell", decisionSlot: r.t + STEP, entry, sl, tp1, rangeHigh, rangeLow, volumeRatio: vr });
        break;
      }
    }
  }
  return out;
}
