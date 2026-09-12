import { shadowCostR } from "./shadow-costs";

export interface K1Bar { assetId: string; t: number; o: number; h: number; l: number; c: number }

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
  terminal: "tp1" | "sl" | "pending";
  grossR: number | null;
  reachedTp1: boolean;
  sameBarAmbiguous: boolean;
  tp1ThenSl: boolean;
}

export interface K1Report {
  hypothesisId: "K1_FAILED_BREAKOUT_TRAP_15M";
  source: "market_m15";
  timeframe: "15m";
  registeredAt: number;
  candidates: number;
  uniqueBreakoutEvents: number;
  decided: number;
  tp1: number;
  sl: number;
  pending: number;
  expired: number;
  successPct: number | null;
  meanGrossR: number | null;
  train: { n: number; decided: number; successPct: number | null; expectancyR: number | null };
  test: { hidden: boolean; n: number; decided: number; successPct: number | null; expectancyR: number | null };
  costsKnown: false;
  netExpectancyR: null;
  fillModels: {
    touchDecided: number;
    closeThroughDecided: number;
    touchExpectancyR: number | null;
    closeThroughExpectancyR: number | null;
    discordantCount: number;
    agreeSameFirstTouch: number;
    touchSl_ctTp1: number;
    touchTp1_ctSl: number;
    touchSl_ctPending: number;
    touchTp1_ctPending: number;
  };
  path: { reachedTp1: number; ambiguous: number; tp1ThenSl: number };
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

// Fixed at registration time. This is a cohort boundary, not a tunable K1 parameter.
export const K1_REGISTERED_AT = Math.floor(Date.parse("2026-09-12T06:30:00Z") / 1000);

export const K1_PARAMETERS = Object.freeze({
  timeframe: "15m", source: "market_m15", atrPeriodBars: ATR_PERIOD, rangeLookbackBars: RANGE_LOOKBACK,
  breakoutCloseAtr: BREAKOUT_CLOSE_ATR, maxFailureBars: MAX_FAILURE_BARS, reclaimClose: "back_inside_prior_range",
  stopPlacement: "failed_extreme_plus_buffer", stopBufferAtr: STOP_BUFFER_ATR, minRiskAtr: MIN_RISK_ATR,
  maxRiskAtr: MAX_RISK_ATR, tp1R: TP1_R, tp2R: null, decision: "close_of_first_failure_reclaim",
  outcomeStarts: "next_closed_bar", oneCandidatePerBreakout: true, volumeFilter: false, sessionFilter: false,
  newsFilter: false, assetFilter: "all", touchAndCloseThrough: "both_research_scenarios", unknownCostsBlockPromotion: true,
});

function trueRange(bar: K1Bar, previous: K1Bar | undefined): number {
  if (!previous) return bar.h - bar.l;
  return Math.max(bar.h - bar.l, Math.abs(bar.h - previous.c), Math.abs(bar.l - previous.c));
}

function atrAt(bars: readonly K1Bar[], i: number): number | null {
  if (i < ATR_PERIOD) return null;
  let sum = 0;
  for (let k = i - ATR_PERIOD; k < i; k += 1) sum += trueRange(bars[k]!, bars[k - 1]);
  const atr = sum / ATR_PERIOD;
  return Number.isFinite(atr) && atr > 0 ? atr : null;
}

function firstTouchForModel(candidate: K1Candidate, bars: readonly K1Bar[], model: "touch" | "close_through"): "tp1" | "sl" | null {
  for (const bar of bars) {
    if (bar.t < candidate.decisionSlot) continue;
    const sl = model === "touch"
      ? candidate.direction === "buy" ? bar.l <= candidate.sl : bar.h >= candidate.sl
      : candidate.direction === "buy" ? bar.c <= candidate.sl : bar.c >= candidate.sl;
    const tp1 = model === "touch"
      ? candidate.direction === "buy" ? bar.h >= candidate.tp1 : bar.l <= candidate.tp1
      : candidate.direction === "buy" ? bar.c >= candidate.tp1 : bar.c <= candidate.tp1;
    if (sl && tp1) return "sl";
    if (sl) return "sl";
    if (tp1) return "tp1";
  }
  return null;
}

function grossRForTouch(firstTouch: "tp1" | "sl" | null): number | null {
  return firstTouch === "tp1" ? TP1_R : firstTouch === "sl" ? -1 : null;
}

function outcomeFor(candidate: K1Candidate, bars: readonly K1Bar[]): K1Outcome {
  let firstTouch: K1Outcome["firstTouch"] = null;
  let reachedTp1 = false;
  let sameBarAmbiguous = false;
  let tp1ThenSl = false;
  let tp1Seen = false;

  for (const bar of bars) {
    if (bar.t < candidate.decisionSlot) continue;
    const sl = candidate.direction === "buy" ? bar.l <= candidate.sl : bar.h >= candidate.sl;
    const tp1 = candidate.direction === "buy" ? bar.h >= candidate.tp1 : bar.l <= candidate.tp1;
    if (sl && tp1) {
      sameBarAmbiguous = true;
      if (firstTouch == null) firstTouch = "sl";
      break;
    }
    if (tp1) {
      reachedTp1 = true;
      tp1Seen = true;
      if (firstTouch == null) firstTouch = "tp1";
      continue;
    }
    if (sl) {
      if (tp1Seen) tp1ThenSl = true;
      if (firstTouch == null) firstTouch = "sl";
      break;
    }
  }

  const grossR = grossRForTouch(firstTouch);
  const terminal: K1Outcome["terminal"] = firstTouch == null ? "pending" : firstTouch;
  return { candidate, firstTouch, terminal, grossR, reachedTp1, sameBarAmbiguous, tp1ThenSl };
}

export function scanK1FailedBreakout(assetBars: readonly K1Bar[]): K1Candidate[] {
  const bars = [...assetBars].sort((a, b) => a.t - b.t);
  const out: K1Candidate[] = [];
  let i = Math.max(RANGE_LOOKBACK, ATR_PERIOD);

  while (i < bars.length - 1) {
    const atr = atrAt(bars, i);
    if (atr == null) {
      i += 1;
      continue;
    }
    const rangeBars = bars.slice(i - RANGE_LOOKBACK, i);
    const rangeHigh = Math.max(...rangeBars.map((b) => b.h));
    const rangeLow = Math.min(...rangeBars.map((b) => b.l));
    const breakout = bars[i]!;
    const up = breakout.c >= rangeHigh + BREAKOUT_CLOSE_ATR * atr;
    const down = breakout.c <= rangeLow - BREAKOUT_CLOSE_ATR * atr;
    if (!up && !down) {
      i += 1;
      continue;
    }

    const endJ = Math.min(i + MAX_FAILURE_BARS, bars.length - 1);
    let consumedThrough = endJ;
    for (let j = i + 1; j <= endJ; j += 1) {
      const failure = bars[j]!;
      if (up && failure.l <= rangeHigh && failure.c < rangeHigh) {
        const failureExtreme = Math.max(breakout.h, failure.h);
        const entry = failure.c;
        const sl = failureExtreme + STOP_BUFFER_ATR * atr;
        const risk = sl - entry;
        consumedThrough = j;
        if (risk / atr < MIN_RISK_ATR || risk / atr > MAX_RISK_ATR) break;
        out.push({ assetId: breakout.assetId, direction: "sell", breakoutSlot: breakout.t + BAR_SEC, decisionSlot: failure.t + BAR_SEC,
          entry, sl, tp1: entry - TP1_R * risk, risk, atr, rangeHigh, rangeLow, breakoutExtreme: breakout.h, failureExtreme: failure.h });
        break;
      }
      if (down && failure.h >= rangeLow && failure.c > rangeLow) {
        const failureExtreme = Math.min(breakout.l, failure.l);
        const entry = failure.c;
        const sl = failureExtreme - STOP_BUFFER_ATR * atr;
        const risk = entry - sl;
        consumedThrough = j;
        if (risk / atr < MIN_RISK_ATR || risk / atr > MAX_RISK_ATR) break;
        out.push({ assetId: breakout.assetId, direction: "buy", breakoutSlot: breakout.t + BAR_SEC, decisionSlot: failure.t + BAR_SEC,
          entry, sl, tp1: entry + TP1_R * risk, risk, atr, rangeHigh, rangeLow, breakoutExtreme: breakout.l, failureExtreme: failure.l });
        break;
      }
    }
    i = consumedThrough + 1;
  }
  return out;
}

function successPct(outcomes: readonly K1Outcome[]): number | null {
  const decided = outcomes.filter((o) => o.grossR != null);
  return decided.length ? (decided.filter((o) => o.firstTouch === "tp1").length / decided.length) * 100 : null;
}

function expectancy(outcomes: readonly K1Outcome[]): number | null {
  const decided = outcomes.map((o) => o.grossR).filter((v): v is number => v != null);
  return decided.length ? decided.reduce((a, b) => a + b, 0) / decided.length : null;
}

function summarize(outcomes: readonly K1Outcome[]) {
  return { n: outcomes.length, decided: outcomes.filter((o) => o.grossR != null).length, successPct: successPct(outcomes), expectancyR: expectancy(outcomes) };
}

export function buildK1Report(byAsset: Readonly<Record<string, readonly K1Bar[]>>): K1Report {
  const candidates = Object.values(byAsset).flatMap((bars) => scanK1FailedBreakout(bars));
  const outcomes = candidates.map((candidate) => outcomeFor(candidate, byAsset[candidate.assetId] ?? []));
  const train = outcomes.filter((o) => o.candidate.decisionSlot < K1_REGISTERED_AT);
  const test = outcomes.filter((o) => o.candidate.decisionSlot >= K1_REGISTERED_AT);

  const fillOutcomes = (model: "touch" | "close_through") => outcomes.map((o) => ({
    ...o,
    firstTouch: firstTouchForModel(o.candidate, byAsset[o.candidate.assetId] ?? [], model),
    grossR: grossRForTouch(firstTouchForModel(o.candidate, byAsset[o.candidate.assetId] ?? [], model)),
  }));
  const touch = fillOutcomes("touch");
  const closeThrough = fillOutcomes("close_through");

  for (const outcome of outcomes) {
    shadowCostR(outcome.grossR, { spreadPrice: null, commissionPrice: null, riskPrice: outcome.candidate.risk });
  }

  const discordant = outcomes.map((_, index) => ({ touch: touch[index]!.firstTouch, closeThrough: closeThrough[index]!.firstTouch }))
    .filter(({ touch: t, closeThrough: ct }) => t !== ct && (t !== null || ct !== null));
  const agreeSameFirstTouch = outcomes.map((_, index) => ({ touch: touch[index]!.firstTouch, closeThrough: closeThrough[index]!.firstTouch }))
    .filter(({ touch: t, closeThrough: ct }) => t !== null && t === ct).length;
  const touchSl_ctTp1 = outcomes.filter((_, index) => touch[index]!.firstTouch === "sl" && closeThrough[index]!.firstTouch === "tp1").length;
  const touchTp1_ctSl = outcomes.filter((_, index) => touch[index]!.firstTouch === "tp1" && closeThrough[index]!.firstTouch === "sl").length;
  const touchSl_ctPending = outcomes.filter((_, index) => touch[index]!.firstTouch === "sl" && closeThrough[index]!.firstTouch === null).length;
  const touchTp1_ctPending = outcomes.filter((_, index) => touch[index]!.firstTouch === "tp1" && closeThrough[index]!.firstTouch === null).length;

  return {
    hypothesisId: "K1_FAILED_BREAKOUT_TRAP_15M", source: "market_m15", timeframe: "15m", registeredAt: K1_REGISTERED_AT,
    candidates: outcomes.length, uniqueBreakoutEvents: outcomes.length,
    decided: outcomes.filter((o) => o.grossR != null).length,
    tp1: outcomes.filter((o) => o.firstTouch === "tp1").length, sl: outcomes.filter((o) => o.firstTouch === "sl").length,
    pending: outcomes.filter((o) => o.firstTouch == null).length, expired: 0,
    successPct: successPct(outcomes), meanGrossR: expectancy(outcomes),
    train: summarize(train),
    test: { hidden: true, n: test.length, decided: 0, successPct: null, expectancyR: null },
    costsKnown: false, netExpectancyR: null,
    fillModels: {
      touchDecided: touch.filter((o) => o.grossR != null).length,
      closeThroughDecided: closeThrough.filter((o) => o.grossR != null).length,
      touchExpectancyR: expectancy(touch), closeThroughExpectancyR: expectancy(closeThrough),
      discordantCount: discordant.length, agreeSameFirstTouch,
      touchSl_ctTp1, touchTp1_ctSl, touchSl_ctPending, touchTp1_ctPending,
    },
    path: {
      reachedTp1: outcomes.filter((o) => o.reachedTp1).length,
      ambiguous: outcomes.filter((o) => o.sameBarAmbiguous).length,
      tp1ThenSl: outcomes.filter((o) => o.tp1ThenSl).length,
    },
    parameters: K1_PARAMETERS,
  };
}
