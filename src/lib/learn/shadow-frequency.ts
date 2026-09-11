import type {
  ShadowCandidateReason,
  ShadowCandidateResult,
  ShadowEpisode,
} from "./shadow-replay";
import {
  isExtraVsV1,
  shadowCandidateForTest,
  shadowOutcomeForTest,
  slotToMs,
  v1EntryByEpisode,
} from "./shadow-replay";
import { MIN_TEST_N } from "./shadow-analysis";

/**
 * Research-only V2 frequency layer.
 * Does not execute trades, does not relax V1, does not invent tape.
 * TRAIN never tunes thresholds. TEST never feeds candidate generation.
 */
export const FREQUENCY_STRATEGIES = [
  "BREAKOUT_RETEST",
  "LIQUIDITY_SWEEP",
  "FVG_RETEST",
  "MOMENTUM_PULLBACK",
] as const;

export type FrequencyStrategyId = (typeof FREQUENCY_STRATEGIES)[number];

export const FREQUENCY_TARGET_PER_DAY = { min: 5, max: 10, obligation: false as const };

const STRATEGY_SOURCE: Record<FrequencyStrategyId, ShadowCandidateReason> = {
  BREAKOUT_RETEST: "BREAKOUT_RETEST",
  LIQUIDITY_SWEEP: "ZONE_SWEEP_RECLAIM_MID",
  FVG_RETEST: "FVG_RETEST_FULL",
  MOMENTUM_PULLBACK: "MOMENTUM_PULLBACK",
};

const STRATEGY_LABEL: Record<FrequencyStrategyId, string> = {
  BREAKOUT_RETEST: "Breakout + retest",
  LIQUIDITY_SWEEP: "Liquidity sweep + reclaim",
  FVG_RETEST: "FVG retest",
  MOMENTUM_PULLBACK: "Momentum + pullback",
};

export type FrequencyPromotionStatus =
  | "INSUFFICIENT"
  | "KEEP_RESEARCH"
  | "DISCARD"
  | "NOT_A_V2_CANDIDATE";

export interface FrequencyBreakdown {
  key: string;
  n: number;
  tp1: number;
  tp2: number;
  sl: number;
  expired: number;
  pending: number;
  decided: number;
  successPct: number | null;
}

export interface FrequencyPromotion {
  live: false;
  status: FrequencyPromotionStatus;
  reasons: string[];
  meetsSample: boolean;
  positiveExpectancy: boolean;
  stableAssets: boolean | null;
  stableSessions: boolean | null;
  testConsistent: boolean | null;
  noLookahead: true;
  frequencyInBand: boolean | null;
}

export interface FrequencyStrategyStats {
  strategy: FrequencyStrategyId;
  label: string;
  sourceVariant: ShadowCandidateReason;
  candidates: number;
  extra: number;
  overlap: number;
  tp1: number;
  tp2: number;
  sl: number;
  expired: number;
  pending: number;
  decided: number;
  successPct: number | null;
  meanR: number | null;
  expectancyR: number | null;
  meanMfe: number | null;
  meanMae: number | null;
  opportunitiesPerDay: number | null;
  sampleDays: number;
  extraTestN: number;
  byAsset: FrequencyBreakdown[];
  bySession: FrequencyBreakdown[];
  train: FrequencyBreakdown;
  test: FrequencyBreakdown;
  promotion: FrequencyPromotion;
}

export interface ShadowFrequencyReport {
  generatedFromEpisodes: number;
  v1Entries: number;
  daysSpanned: number;
  lowerTf: { used: false; synthesized: false; reason: string };
  targetPerDay: typeof FREQUENCY_TARGET_PER_DAY;
  strategies: FrequencyStrategyStats[];
  notes: string[];
}

function finite(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function successPct(tp1: number, tp2: number, sl: number): number | null {
  const decided = tp1 + tp2 + sl;
  if (!decided) return null;
  return ((tp1 + tp2) / decided) * 100;
}

function utcDay(slotSec: number): string {
  return new Date(slotToMs(slotSec)).toISOString().slice(0, 10);
}

export function sampleDaysOf(rows: readonly { decisionSlot: number }[]): number {
  return new Set(rows.map((r) => utcDay(r.decisionSlot))).size;
}

export function opportunitiesPerDay(candidates: number, days: number): number | null {
  if (days <= 0) return null;
  return candidates / days;
}

function tallies(rows: readonly ShadowCandidateResult[]): Omit<FrequencyBreakdown, "key"> {
  const tp1 = rows.filter((r) => r.outcome === "tp1").length;
  const tp2 = rows.filter((r) => r.outcome === "tp2").length;
  const sl = rows.filter((r) => r.outcome === "sl").length;
  const expired = rows.filter((r) => r.outcome === "expired").length;
  const pending = rows.filter((r) => r.outcome === "pending").length;
  const decided = tp1 + tp2 + sl;
  return {
    n: rows.length,
    tp1,
    tp2,
    sl,
    expired,
    pending,
    decided,
    successPct: successPct(tp1, tp2, sl),
  };
}

function breakdown(key: string, rows: readonly ShadowCandidateResult[]): FrequencyBreakdown {
  return { key, ...tallies(rows) };
}

function byKey(rows: readonly ShadowCandidateResult[], value: (r: ShadowCandidateResult) => string): FrequencyBreakdown[] {
  return [...new Set(rows.map(value))].sort().map((k) => breakdown(k, rows.filter((r) => value(r) === k)));
}

export function evaluateFrequencyPromotion(input: {
  extraTestN: number;
  trainExpectancyR: number | null;
  testExpectancyR: number | null;
  opportunitiesPerDay: number | null;
  assetSuccessRangePp: number | null;
  sessionSuccessRangePp: number | null;
  assetCoverage: number;
  sessionCoverage: number;
}): FrequencyPromotion {
  const meetsSample = input.extraTestN >= MIN_TEST_N;
  const positiveExpectancy = (input.trainExpectancyR ?? 0) > 0;
  const testConsistent = input.testExpectancyR == null ? null : input.testExpectancyR > 0;
  const stableAssets =
    input.assetCoverage < 2 || input.assetSuccessRangePp == null ? null : input.assetSuccessRangePp <= 40;
  const stableSessions =
    input.sessionCoverage < 2 || input.sessionSuccessRangePp == null ? null : input.sessionSuccessRangePp <= 40;
  const frequencyInBand =
    input.opportunitiesPerDay == null
      ? null
      : input.opportunitiesPerDay >= FREQUENCY_TARGET_PER_DAY.min &&
        input.opportunitiesPerDay <= FREQUENCY_TARGET_PER_DAY.max;

  const reasons: string[] = [];
  if (!meetsSample) reasons.push(`EXTRA TEST ${input.extraTestN}/${MIN_TEST_N}`);
  if (!positiveExpectancy) reasons.push("expectativa TRAIN no positiva");
  if (testConsistent === false) reasons.push("TEST no confirma expectativa positiva");
  if (stableAssets === false) reasons.push("éxito inestable por activo");
  if (stableSessions === false) reasons.push("éxito inestable por sesión");
  reasons.push("frecuencia 5–10/día es informativa, no un criterio de promoción");
  reasons.push("Shadow no ejecuta ni autoriza operaciones");

  let status: FrequencyPromotionStatus = "NOT_A_V2_CANDIDATE";
  if (!meetsSample) status = "INSUFFICIENT";
  else if (!positiveExpectancy || testConsistent === false) status = "DISCARD";
  else if (positiveExpectancy && testConsistent) status = "KEEP_RESEARCH";

  return {
    live: false,
    status,
    reasons,
    meetsSample,
    positiveExpectancy,
    stableAssets,
    stableSessions,
    testConsistent,
    noLookahead: true,
    frequencyInBand,
  };
}

function expectancyOf(rows: readonly ShadowCandidateResult[]): number | null {
  const decided = rows.filter((r) => r.outcome === "tp1" || r.outcome === "tp2" || r.outcome === "sl");
  return mean(decided.map((r) => r.rrAtOutcome).filter(finite));
}

function successRangePp(rows: readonly ShadowCandidateResult[], key: (r: ShadowCandidateResult) => string): {
  coverage: number;
  range: number | null;
} {
  const groups = [...new Set(rows.map(key))];
  const pcts = groups
    .map((g) => tallies(rows.filter((r) => key(r) === g)).successPct)
    .filter((v): v is number => v != null);
  return { coverage: groups.length, range: pcts.length >= 2 ? Math.max(...pcts) - Math.min(...pcts) : null };
}

export function replayFrequencyCandidates(
  episodes: readonly ShadowEpisode[],
  strategy: FrequencyStrategyId,
): ShadowCandidateResult[] {
  const source = STRATEGY_SOURCE[strategy];
  const out: ShadowCandidateResult[] = [];
  for (const ep of episodes) {
    const candidate = shadowCandidateForTest(ep, source);
    if (!candidate) continue;
    out.push(shadowOutcomeForTest(candidate, ep));
  }
  return out;
}

export function buildShadowFrequencyReport(episodes: readonly ShadowEpisode[]): ShadowFrequencyReport {
  const v1Entries = v1EntryByEpisode(episodes);
  const ordered = [...episodes].sort((a, b) => a.case.openedAtMs - b.case.openedAtMs);
  const cutMs = ordered[Math.floor(ordered.length * 0.7) - 1]?.case.openedAtMs ?? Number.POSITIVE_INFINITY;
  const allDays = sampleDaysOf(
    episodes.flatMap((e) => [{ decisionSlot: e.case.openedSlot }]),
  );

  const strategies = FREQUENCY_STRATEGIES.map((strategy) => {
    const rows = replayFrequencyCandidates(episodes, strategy);
    const extraRows = rows.filter((r) => isExtraVsV1(r.episodeId, v1Entries));
    const overlapRows = rows.filter((r) => !isExtraVsV1(r.episodeId, v1Entries));
    const trainRows = rows.filter((r) => slotToMs(r.decisionSlot) <= cutMs);
    const testRows = rows.filter((r) => slotToMs(r.decisionSlot) > cutMs);
    const extraTest = extraRows.filter((r) => slotToMs(r.decisionSlot) > cutMs);
    const extraTestDecided = extraTest.filter((r) => r.outcome === "tp1" || r.outcome === "tp2" || r.outcome === "sl");
    const totals = tallies(rows);
    const days = sampleDaysOf(rows);
    const perDay = opportunitiesPerDay(rows.length, days);
    const assets = successRangePp(rows, (r) => r.features.assetId);
    const sessions = successRangePp(rows, (r) => r.features.session);
    return {
      strategy,
      label: STRATEGY_LABEL[strategy],
      sourceVariant: STRATEGY_SOURCE[strategy],
      candidates: totals.n,
      extra: extraRows.length,
      overlap: overlapRows.length,
      tp1: totals.tp1,
      tp2: totals.tp2,
      sl: totals.sl,
      expired: totals.expired,
      pending: totals.pending,
      decided: totals.decided,
      successPct: totals.successPct,
      meanR: expectancyOf(rows),
      expectancyR: expectancyOf(rows),
      meanMfe: mean(rows.map((r) => r.mfe).filter(finite)),
      meanMae: mean(rows.map((r) => r.mae).filter(finite)),
      opportunitiesPerDay: perDay,
      sampleDays: days,
      extraTestN: extraTestDecided.length,
      byAsset: byKey(rows, (r) => r.features.assetId),
      bySession: byKey(rows, (r) => r.features.session),
      train: breakdown("TRAIN", trainRows),
      test: breakdown("TEST", testRows),
      promotion: evaluateFrequencyPromotion({
        extraTestN: extraTestDecided.length,
        trainExpectancyR: expectancyOf(trainRows),
        testExpectancyR: expectancyOf(testRows),
        opportunitiesPerDay: perDay,
        assetSuccessRangePp: assets.range,
        sessionSuccessRangePp: sessions.range,
        assetCoverage: assets.coverage,
        sessionCoverage: sessions.coverage,
      }),
    } satisfies FrequencyStrategyStats;
  });

  return {
    generatedFromEpisodes: episodes.length,
    v1Entries: v1Entries.size,
    daysSpanned: allDays,
    lowerTf: {
      used: false,
      synthesized: false,
      reason: "15M es el timeframe de decisión. 5M/1M solo si existe cinta real capturada; nunca se sintetizan desde 15M.",
    },
    targetPerDay: FREQUENCY_TARGET_PER_DAY,
    strategies,
    notes: [
      "Universo = mapas V1 congelados. EXTRA no exige ENTRY V1; OVERLAP comparte episodeId con ENTRY.",
      "expired y pending no entran en el denominador de éxito.",
      "TP1/TP2 = éxito. SL = pérdida. Misma vela SL+TP → SL.",
      "Los umbrales están fijos antes de TEST. Más operaciones no promocionan una variante.",
      "5–10 oportunidades/día es un objetivo de investigación, no una obligación ni un criterio de promoción.",
      "Ninguna estrategia está conectada al flujo live.",
    ],
  };
}

export const SHADOW_FREQUENCY_PLAN = Object.freeze({
  strategies: FREQUENCY_STRATEGIES,
  liveSignal: false as const,
  modifiesV1: false as const,
  synthesizesLowerTf: false as const,
  optimizesOnTest: false as const,
});
