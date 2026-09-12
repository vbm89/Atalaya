import { shadowCostR } from "./shadow-costs";

export interface K1Bar {
  assetId: string;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface K1Candidate {
  assetId: string;
  direction: "buy" | "sell";
  breakoutSlot: number;
  decisionSlot: number;
  entry: number;
  sl: number;
  tp1: number;
  risk: number;
  atr: number;
  rangeHigh: number;
  rangeLow: number;
  breakoutExtreme: number;
  failureExtreme: number;
}

export interface K1Outcome {
  candidate: K1Candidate;
  firstTouch: "tp1" | "sl" | null;
  terminal: "tp1" | "sl" | "expired";
  grossR: number | null;
  reachedTp1: boolean;
  sameBarAmbiguous: boolean;
}

export interface K1Report {
  hypothesisId: "K1_FAILED_BREAKOUT_TRAP_15M";
  source: "market_m15";
  timeframe: "15m";
  candidates: number;
  decided: number;
  tp1: number;
  sl: number;
  expired: number;
  successPct: number | null;
  meanGrossR: number | null;
  train: { n: number; decided: number; successPct: number | null; expectancyR: number | null };
  test: { n: number; decided: number; successPct: number | null; expectancyR: number | null };
  costsKnown: false;
  netExpectancyR: null;
  fillModels: {
    touchDecided: number;
    closeThroughDecided: number;
    touchExpectancyR: number | null;
    closeThroughExpectancyR: number | null;
  };
  path: {
    reachedTp1: number;
    ambiguous: number;
    tp1ThenSl: number;
  };
  parameters: Readonly<Record<string, string | number | boolean | null>>;
}

const ATR_PERIOD = 14;
const RANGE_LOOKBACK = 16;
const BREAKOUT_CLOSE_ATR = 0.1;
const MAX_FAILURE_BARS = 4;
const STOP_BUFFER_ATR = 0.1;
const MIN_RISK_ATR = 0.25;
const MAX_RISK_ATR = 2;
const TP1_R = 2;
const BAR_SEC = 900;

export const K1_PARAMETERS = Object.freeze({
  timeframe: "15m",
  source: "market_m15",
  atrPeriodBars: ATR_PERIOD,
  rangeLookbackBars: RANGE_LOOKBACK,
  breakoutCloseAtr: BREAKOUT_CLOSE_ATR,
  maxFailureBars: MAX_FAILURE_BARS,
  reclaimClose: "back_inside_prior_range",
  stopPlacement: "failed_extreme_plus_buffer",
  stopBufferAtr: STOP_BUFFER_ATR,
  minRiskAtr: MIN_RISK_ATR,
  maxRiskAtr: MAX_RISK_ATR,
  tp1R: TP1_R,
  tp2R: null,
  decision: "close_of_first_failure_reclaim",
  outcomeStarts: "next_closed_bar",
  oneCandidatePerBreakout: true,
  volumeFilter: false,
  sessionFilter: false,
  newsFilter: false,
});

function trueRange(bar: K1Bar, previous: K1Bar | undefined): number {
  if (!previous) return bar.h - bar.l;
  return Math.max(bar.h - bar.l, Math.abs(bar.h - previous.c), Math.abs(bar.l - previous.c));
}

function atrAt(bars: readonly K1Bar[], i: number): number | null {
  if (i < ATR_PERIOD) return null;
  const values = bars.slice(i - ATR_PERIOD, i).map((b, offset) => trueRange(b, bars[i - ATR_PERIOD + offset - 1]));
  const atr = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number.isFinite(atr) && atr > 0 ? atr : null;
}

function grossR(firstTouch: K1Outcome["firstTouch"], candidate: K1Candidate): number | null {
  if (firstTouch === "tp1") return TP1_R;
  if (firstTouch === "sl") return -1;
  return null;
}

function outcomeFor(candidate: K1Candidate, bars: readonly K1Bar[]): K1Outcome {
  let firstTouch: K1Outcome["firstTouch"] = null;
  let reachedTp1 = false;
  let sameBarAmbiguous = false;

  for (const bar of bars) {
    if (bar.t < candidate.decisionSlot) continue;
    const sl = candidate.direction === "buy" ? bar.l <= candidate.sl : bar.h >= candidate.sl;
    const tp1 = candidate.direction === "buy" ? bar.h >= candidate.tp1 : bar.l <= candidate.tp1;
    if (tp1) reachedTp1 = true;
    if (sl && tp1) {
      firstTouch = "sl";
      sameBarAmbiguous = true;
      break;
    }
    if (sl) {
      firstTouch = "sl";
      break;
    }
    if (tp1) {
      firstTouch = "tp1";
      break;
    }
  }

  return {
    candidate,
    firstTouch,
    terminal: firstTouch ?? "expired",
    grossR: grossR(firstTouch, candidate),
    reachedTp1,
    sameBarAmbiguous,
  };
}

export function scanK1FailedBreakout(assetBars: readonly K1Bar[]): K1Candidate[] {
  const bars = [...assetBars].sort((a, b) => a.t - b.t);
  const out: K1Candidate[] = [];

  for (let i = Math.max(RANGE_LOOKBACK, ATR_PERIOD); i < bars.length - 1; i += 1) {
    const atr = atrAt(bars, i);
    if (atr == null) continue;
    const rangeBars = bars.slice(i - RANGE_LOOKBACK, i);
    const rangeHigh = Math.max(...rangeBars.map((b) => b.h));
    const rangeLow = Math.min(...rangeBars.map((b) => b.l));
    const breakout = bars[i]!;
    const up = breakout.c >= rangeHigh + BREAKOUT_CLOSE_ATR * atr;
    const down = breakout.c <= rangeLow - BREAKOUT_CLOSE_ATR * atr;
    if (!up && !down) continue;

    for (let j = i + 1; j <= Math.min(i + MAX_FAILURE_BARS, bars.length - 1); j += 1) {
      const failure = bars[j]!;
      if (up && failure.l <= rangeHigh && failure.c < rangeHigh) {
        const failureExtreme = Math.max(breakout.h, failure.h);
        const entry = failure.c;
        const sl = failureExtreme + STOP_BUFFER_ATR * atr;
        const risk = sl - entry;
        if (risk / atr < MIN_RISK_ATR || risk / atr > MAX_RISK_ATR) break;
        out.push({
          assetId: breakout.assetId,
          direction: "sell",
          breakoutSlot: breakout.t + BAR_SEC,
          decisionSlot: failure.t + BAR_SEC,
          entry,
          sl,
          tp1: entry - TP1_R * risk,
          risk,
          atr,
          rangeHigh,
          rangeLow,
          breakoutExtreme: breakout.h,
          failureExtreme: failure.h,
        });
        break;
      }
      if (down && failure.h >= rangeLow && failure.c > rangeLow) {
        const failureExtreme = Math.min(breakout.l, failure.l);
        const entry = failure.c;
        const sl = failureExtreme - STOP_BUFFER_ATR * atr;
        const risk = entry - sl;
        if (risk / atr < MIN_RISK_ATR || risk / atr > MAX_RISK_ATR) break;
        out.push({
          assetId: breakout.assetId,
          direction: "buy",
          breakoutSlot: breakout.t + BAR_SEC,
          decisionSlot: failure.t + BAR_SEC,
          entry,
          sl,
          tp1: entry + TP1_R * risk,
          risk,
          atr,
          rangeHigh,
          rangeLow,
          breakoutExtreme: breakout.l,
          failureExtreme: failure.l,
        });
        break;
      }
    }
  }
  return out;
}

function successPct(outcomes: readonly K1Outcome[]): number | null {
  const decided = outcomes.filter((o) => o.grossR != null);
  if (!decided.length) return null;
  return (decided.filter((o) => o.firstTouch === "tp1").length / decided.length) * 100;
}

function expectancy(outcomes: readonly K1Outcome[]): number | null {
  const decided = outcomes.map((o) => o.grossR).filter((v): v is number => v != null);
  return decided.length ? decided.reduce((a, b) => a + b, 0) / decided.length : null;
}

function summarize(outcomes: readonly K1Outcome[]) {
  const decided = outcomes.filter((o) => o.grossR != null);
  return {
    n: outcomes.length,
    decided: decided.length,
    successPct: successPct(outcomes),
    expectancyR: expectancy(outcomes),
  };
}

/**
 * K1 report is independent of V1 episodes. TEST is a time split over the
 * continuous market_m15 tape. Costs stay unknown until real execution data exists.
 */
export function buildK1Report(byAsset: Readonly<Record<string, readonly K1Bar[]>>): K1Report {
  const candidates = Object.values(byAsset).flatMap((bars) => scanK1FailedBreakout(bars));
  const outcomes = candidates.map((candidate) => outcomeFor(candidate, byAsset[candidate.assetId] ?? []));
  const slots = [...new Set(outcomes.map((o) => o.candidate.decisionSlot))].sort((a, b) => a - b);
  const cut = slots.length ? slots[Math.max(0, Math.floor(slots.length * 0.8) - 1)]! : 0;
  const train = outcomes.filter((o) => o.candidate.decisionSlot <= cut);
  const test = outcomes.filter((o) => o.candidate.decisionSlot > cut);
  const touch = outcomes.filter((o) => o.grossR != null);
  const closeThrough = outcomes.filter((o) => o.grossR != null);
  const tp1ThenSl = outcomes.filter((o) => o.reachedTp1 && o.firstTouch === "sl").length;
  const ambiguous = outcomes.filter((o) => o.sameBarAmbiguous).length;
  const meanGrossR = expectancy(outcomes);

  // Exercise the shared cost contract with missing execution data. It must return
  // netR=null rather than silently treating unknown costs as zero.
  for (const outcome of outcomes) {
    shadowCostR(outcome.grossR, {
      spreadPrice: null,
      commissionPrice: null,
      riskPrice: outcome.candidate.risk,
    });
  }

  return {
    hypothesisId: "K1_FAILED_BREAKOUT_TRAP_15M",
    source: "market_m15",
    timeframe: "15m",
    candidates: outcomes.length,
    decided: outcomes.filter((o) => o.grossR != null).length,
    tp1: outcomes.filter((o) => o.firstTouch === "tp1").length,
    sl: outcomes.filter((o) => o.firstTouch === "sl").length,
    expired: outcomes.filter((o) => o.firstTouch == null).length,
    successPct: successPct(outcomes),
    meanGrossR,
    train: summarize(train),
    test: summarize(test),
    costsKnown: false,
    netExpectancyR: null,
    fillModels: {
      touchDecided: touch.length,
      closeThroughDecided: closeThrough.length,
      touchExpectancyR: expectancy(touch),
      closeThroughExpectancyR: expectancy(closeThrough),
    },
    path: {
      reachedTp1: outcomes.filter((o) => o.reachedTp1).length,
      ambiguous,
      tp1ThenSl,
    },
    parameters: K1_PARAMETERS,
  };
}
