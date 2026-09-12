import { shadowCostR } from "./shadow-costs";
import { isHypothesisSealed } from "./shadow-preregister";

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

export type K1EventDisposition = "candidate" | "risk_veto" | "timeout";

export interface K1BreakoutEvent {
  assetId: string;
  direction: "buy" | "sell";
  breakoutSlot: number;
  disposition: K1EventDisposition;
  candidate: K1Candidate | null;
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

export interface K1FillModels {
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
}

export interface K1Path {
  reachedTp1: number;
  ambiguous: number;
  tp1ThenSl: number;
}

export interface K1EventDispositions {
  candidate: number;
  risk_veto: number;
  timeout: number;
}

export interface K1CohortPublic {
  n: number;
  decided: number;
  tp1: number;
  sl: number;
  pending: number;
  expired: 0;
  successPct: number | null;
  expectancyR: number | null;
  fillModels: K1FillModels;
  path: K1Path;
  candidates: number;
  uniqueBreakoutEvents: number;
  breakoutEventDispositions: K1EventDispositions;
}

export interface K1Report {
  hypothesisId: "K1_FAILED_BREAKOUT_TRAP_15M";
  source: "market_m15";
  timeframe: "15m";
  registeredAt: number;
  candidates: number;
  uniqueBreakoutEvents: number;
  breakoutEventDispositions: K1EventDispositions;
  decided: number;
  tp1: number;
  sl: number;
  pending: number;
  expired: number;
  successPct: number | null;
  meanGrossR: number | null;
  train: { n: number; decided: number; successPct: number | null; expectancyR: number | null };
  test: { hidden: true } | ({ hidden: false } & K1CohortPublic);
  costsKnown: false;
  netExpectancyR: null;
  fillModels: K1FillModels;
  path: K1Path;
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
const K1_ID = "K1_FAILED_BREAKOUT_TRAP_15M" as const;

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

function tryReclaim(
  directionUp: boolean,
  breakout: K1Bar,
  failure: K1Bar,
  atr: number,
  rangeHigh: number,
  rangeLow: number,
): { kind: "candidate"; candidate: K1Candidate } | { kind: "risk_veto"; direction: "buy" | "sell"; breakoutSlot: number } | null {
  if (directionUp) {
    if (!(failure.l <= rangeHigh && failure.c < rangeHigh)) return null;
    const failureExtreme = Math.max(breakout.h, failure.h);
    const entry = failure.c;
    const sl = failureExtreme + STOP_BUFFER_ATR * atr;
    const risk = sl - entry;
    const direction = "sell" as const;
    const breakoutSlot = breakout.t + BAR_SEC;
    if (risk / atr < MIN_RISK_ATR || risk / atr > MAX_RISK_ATR) {
      return { kind: "risk_veto", direction, breakoutSlot };
    }
    return {
      kind: "candidate",
      candidate: {
        assetId: breakout.assetId, direction, breakoutSlot, decisionSlot: failure.t + BAR_SEC,
        entry, sl, tp1: entry - TP1_R * risk, risk, atr, rangeHigh, rangeLow,
        breakoutExtreme: breakout.h, failureExtreme,
      },
    };
  }
  if (!(failure.h >= rangeLow && failure.c > rangeLow)) return null;
  const failureExtreme = Math.min(breakout.l, failure.l);
  const entry = failure.c;
  const sl = failureExtreme - STOP_BUFFER_ATR * atr;
  const risk = entry - sl;
  const direction = "buy" as const;
  const breakoutSlot = breakout.t + BAR_SEC;
  if (risk / atr < MIN_RISK_ATR || risk / atr > MAX_RISK_ATR) {
    return { kind: "risk_veto", direction, breakoutSlot };
  }
  return {
    kind: "candidate",
    candidate: {
      assetId: breakout.assetId, direction, breakoutSlot, decisionSlot: failure.t + BAR_SEC,
      entry, sl, tp1: entry + TP1_R * risk, risk, atr, rangeHigh, rangeLow,
      breakoutExtreme: breakout.l, failureExtreme,
    },
  };
}

export function scanK1BreakoutEvents(assetBars: readonly K1Bar[]): K1BreakoutEvent[] {
  const bars = [...assetBars].sort((a, b) => a.t - b.t);
  const events: K1BreakoutEvent[] = [];
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

    const neededEnd = i + MAX_FAILURE_BARS;
    const lastIndex = bars.length - 1;
    let closed = false;
    for (let j = i + 1; j <= Math.min(neededEnd, lastIndex); j += 1) {
      const found = tryReclaim(up, breakout, bars[j]!, atr, rangeHigh, rangeLow);
      if (!found) continue;
      const direction = found.kind === "candidate" ? found.candidate.direction : found.direction;
      const breakoutSlot = found.kind === "candidate" ? found.candidate.breakoutSlot : found.breakoutSlot;
      events.push({
        assetId: breakout.assetId,
        direction,
        breakoutSlot,
        disposition: found.kind === "candidate" ? "candidate" : "risk_veto",
        candidate: found.kind === "candidate" ? found.candidate : null,
      });
      i = j + 1;
      closed = true;
      break;
    }
    if (closed) continue;

    if (lastIndex >= neededEnd) {
      events.push({
        assetId: breakout.assetId,
        direction: up ? "sell" : "buy",
        breakoutSlot: breakout.t + BAR_SEC,
        disposition: "timeout",
        candidate: null,
      });
      i = neededEnd + 1;
      continue;
    }

    // OPEN: not enough bars to complete the 4-bar failure window. Do not
    // count as timeout and do not scan past this origin.
    break;
  }
  return events;
}

export function scanK1FailedBreakout(assetBars: readonly K1Bar[]): K1Candidate[] {
  return scanK1BreakoutEvents(assetBars)
    .map((event) => event.candidate)
    .filter((candidate): candidate is K1Candidate => candidate != null);
}

function uniqueBreakoutEventCount(events: readonly K1BreakoutEvent[]): number {
  return new Set(events.map((event) => `${event.assetId}|${event.direction}|${event.breakoutSlot}`)).size;
}

function dispositionsOf(events: readonly K1BreakoutEvent[]): K1EventDispositions {
  return {
    candidate: events.filter((event) => event.disposition === "candidate").length,
    risk_veto: events.filter((event) => event.disposition === "risk_veto").length,
    timeout: events.filter((event) => event.disposition === "timeout").length,
  };
}

function successPct(outcomes: readonly K1Outcome[]): number | null {
  const decided = outcomes.filter((o) => o.grossR != null);
  return decided.length ? (decided.filter((o) => o.firstTouch === "tp1").length / decided.length) * 100 : null;
}

function expectancy(outcomes: readonly K1Outcome[]): number | null {
  const decided = outcomes.map((o) => o.grossR).filter((v): v is number => v != null);
  return decided.length ? decided.reduce((a, b) => a + b, 0) / decided.length : null;
}

function fillModelsOf(outcomes: readonly K1Outcome[], barsOf: (assetId: string) => readonly K1Bar[]): K1FillModels {
  const touch = outcomes.map((o) => firstTouchForModel(o.candidate, barsOf(o.candidate.assetId), "touch"));
  const closeThrough = outcomes.map((o) => firstTouchForModel(o.candidate, barsOf(o.candidate.assetId), "close_through"));
  const touchR = touch.map(grossRForTouch);
  const closeThroughR = closeThrough.map(grossRForTouch);
  const expectancyOf = (values: readonly (number | null)[]): number | null => {
    const decided = values.filter((v): v is number => v != null);
    return decided.length ? decided.reduce((a, b) => a + b, 0) / decided.length : null;
  };
  return {
    touchDecided: touchR.filter((v) => v != null).length,
    closeThroughDecided: closeThroughR.filter((v) => v != null).length,
    touchExpectancyR: expectancyOf(touchR),
    closeThroughExpectancyR: expectancyOf(closeThroughR),
    discordantCount: outcomes.filter((_, index) => touch[index] !== closeThrough[index] && (touch[index] !== null || closeThrough[index] !== null)).length,
    agreeSameFirstTouch: outcomes.filter((_, index) => touch[index] !== null && touch[index] === closeThrough[index]).length,
    touchSl_ctTp1: outcomes.filter((_, index) => touch[index] === "sl" && closeThrough[index] === "tp1").length,
    touchTp1_ctSl: outcomes.filter((_, index) => touch[index] === "tp1" && closeThrough[index] === "sl").length,
    touchSl_ctPending: outcomes.filter((_, index) => touch[index] === "sl" && closeThrough[index] === null).length,
    touchTp1_ctPending: outcomes.filter((_, index) => touch[index] === "tp1" && closeThrough[index] === null).length,
  };
}

function pathOf(outcomes: readonly K1Outcome[]): K1Path {
  return {
    reachedTp1: outcomes.filter((o) => o.reachedTp1).length,
    ambiguous: outcomes.filter((o) => o.sameBarAmbiguous).length,
    tp1ThenSl: outcomes.filter((o) => o.tp1ThenSl).length,
  };
}

function cohortPublic(
  outcomes: readonly K1Outcome[],
  events: readonly K1BreakoutEvent[],
  barsOf: (assetId: string) => readonly K1Bar[],
): K1CohortPublic {
  return {
    n: outcomes.length,
    decided: outcomes.filter((o) => o.grossR != null).length,
    tp1: outcomes.filter((o) => o.firstTouch === "tp1").length,
    sl: outcomes.filter((o) => o.firstTouch === "sl").length,
    pending: outcomes.filter((o) => o.firstTouch == null).length,
    expired: 0,
    successPct: successPct(outcomes),
    expectancyR: expectancy(outcomes),
    fillModels: fillModelsOf(outcomes, barsOf),
    path: pathOf(outcomes),
    candidates: outcomes.length,
    uniqueBreakoutEvents: uniqueBreakoutEventCount(events),
    breakoutEventDispositions: dispositionsOf(events),
  };
}

export function buildK1Report(
  byAsset: Readonly<Record<string, readonly K1Bar[]>>,
  revealTest = isHypothesisSealed(K1_ID),
): K1Report {
  const events = Object.values(byAsset).flatMap((bars) => scanK1BreakoutEvents(bars));
  const candidates = events
    .map((event) => event.candidate)
    .filter((candidate): candidate is K1Candidate => candidate != null);
  const barsOf = (assetId: string) => byAsset[assetId] ?? [];
  const outcomes = candidates.map((candidate) => outcomeFor(candidate, barsOf(candidate.assetId)));

  const trainOutcomes = outcomes.filter((o) => o.candidate.decisionSlot < K1_REGISTERED_AT);
  const testOutcomes = outcomes.filter((o) => o.candidate.decisionSlot >= K1_REGISTERED_AT);
  const trainEvents = events.filter((event) => event.breakoutSlot < K1_REGISTERED_AT);
  const testEvents = events.filter((event) => event.breakoutSlot >= K1_REGISTERED_AT);
  const train = cohortPublic(trainOutcomes, trainEvents, barsOf);

  for (const outcome of trainOutcomes) {
    shadowCostR(outcome.grossR, { spreadPrice: null, commissionPrice: null, riskPrice: outcome.candidate.risk });
  }

  return {
    hypothesisId: K1_ID,
    source: "market_m15",
    timeframe: "15m",
    registeredAt: K1_REGISTERED_AT,
    candidates: train.candidates,
    uniqueBreakoutEvents: train.uniqueBreakoutEvents,
    breakoutEventDispositions: train.breakoutEventDispositions,
    decided: train.decided,
    tp1: train.tp1,
    sl: train.sl,
    pending: train.pending,
    expired: 0,
    successPct: train.successPct,
    meanGrossR: train.expectancyR,
    train: { n: train.n, decided: train.decided, successPct: train.successPct, expectancyR: train.expectancyR },
    test: revealTest
      ? { hidden: false, ...cohortPublic(testOutcomes, testEvents, barsOf) }
      : { hidden: true },
    costsKnown: false,
    netExpectancyR: null,
    fillModels: train.fillModels,
    path: train.path,
    parameters: K1_PARAMETERS,
  };
}
