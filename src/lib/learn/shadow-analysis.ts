import type {
  ShadowCandidateReason,
  ShadowCandidateResult,
  ShadowEpisode,
  ShadowReplayReport,
} from "./shadow-replay";
import {
  SHADOW_VARIANTS,
  replayCandidates,
  buildShadowReplayReport,
  slotToMs,
} from "./shadow-replay";
import { buildShadowHorizonReport, type ShadowHorizonReport } from "./shadow-horizon";
import { analyzeShadowCosts, type ShadowCostAnalysisReport } from "./shadow-cost-analysis";

export type ShadowEvidenceLabel = "INSUFFICIENT" | "DESCRIPTIVE" | "EXPLORATORY" | "CONFIRMATORY";

export interface ShadowComparison {
  variant: ShadowCandidateReason;
  deltaVsBaselinePp: number | null;
  testDeltaVsBaselinePp: number | null;
  additionalOpportunities: number;
  earlierThanBaseline: number;
  extraDecided: number;
  extraSuccessPct: number | null;
  extraTestN: number;
  testN: number;
  assetCoverage: number;
  assetSuccessRangePp: number | null;
  walkForwardTestRangePp: number | null;
  sufficientEvidence: boolean;
  recommendation: "CONTINUE" | "DISCARD" | "INSUFFICIENT";
  evidenceLabel: ShadowEvidenceLabel;
}

export interface WalkForwardWindow {
  index: number;
  trainFromMs: number;
  trainToMs: number;
  testFromMs: number;
  testToMs: number;
  variants: Array<{
    variant: ShadowCandidateReason;
    trainN: number;
    testN: number;
    testSuccessPct: number | null;
  }>;
}

export interface ShadowAnalysisReport {
  replay: ShadowReplayReport;
  comparisons: ShadowComparison[];
  walkForward: WalkForwardWindow[];
  variantsEvaluated: number;
  confirmatoryAllowed: false;
  /** Costs/fill-model analysis is persisted with the replay but never promotes V1. */
  costs: ShadowCostAnalysisReport;
  /** Same candidates, different holding horizons. Research only; never changes V1. */
  horizons: ShadowHorizonReport;
}

export const MIN_TEST_N = 30;
const MATERIAL_WORSENING_PP = 5;

/** CONFIRMATORY is reserved until documented promotion criteria exist. */
export function evidenceLabelFor(
  recommendation: ShadowComparison["recommendation"],
  extraTestN: number,
): ShadowEvidenceLabel {
  if (recommendation === "INSUFFICIENT" || extraTestN < MIN_TEST_N) return "INSUFFICIENT";
  if (recommendation === "CONTINUE") return "EXPLORATORY";
  return "DESCRIPTIVE";
}

function success(rows: readonly ShadowCandidateResult[]): number | null {
  const decided = rows.filter((r) => r.outcome === "tp1" || r.outcome === "tp2" || r.outcome === "sl");
  if (!decided.length) return null;
  return (decided.filter((r) => r.outcome === "tp1" || r.outcome === "tp2").length / decided.length) * 100;
}

function pctDelta(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : a - b;
}

function assetSuccessRange(rows: readonly ShadowCandidateResult[], variant: ShadowCandidateReason): { coverage: number; range: number | null } {
  const vr = rows.filter((r) => r.variant === variant);
  const assets = [...new Set(vr.map((r) => r.features.assetId))];
  const pcts = assets.map((asset) => success(vr.filter((r) => r.features.assetId === asset))).filter((v): v is number => v != null);
  return { coverage: assets.length, range: pcts.length >= 2 ? Math.max(...pcts) - Math.min(...pcts) : null };
}

function makeWalkForward(episodes: readonly ShadowEpisode[], rows: readonly ShadowCandidateResult[]): WalkForwardWindow[] {
  const times = [...new Set(rows.map((r) => slotToMs(r.decisionSlot)))].sort((a, b) => a - b);
  if (times.length < 10) return [];
  const block = Math.max(1, Math.floor(times.length * 0.2));
  const trainSize = block * 3;
  const windows: WalkForwardWindow[] = [];
  let index = 0;
  for (let trainEnd = trainSize; trainEnd + block <= times.length; trainEnd += block) {
    const trainFromMs = times[0]!;
    const trainToMs = times[trainEnd - 1]!;
    const testFromMs = times[trainEnd]!;
    const testToMs = times[Math.min(trainEnd + block - 1, times.length - 1)]!;
    const variants = SHADOW_VARIANTS.map((variant) => {
      const vr = rows.filter((r) => r.variant === variant);
      const train = vr.filter((r) => slotToMs(r.decisionSlot) >= trainFromMs && slotToMs(r.decisionSlot) <= trainToMs);
      const test = vr.filter((r) => slotToMs(r.decisionSlot) >= testFromMs && slotToMs(r.decisionSlot) <= testToMs);
      return { variant, trainN: train.length, testN: test.length, testSuccessPct: success(test) };
    });
    windows.push({ index, trainFromMs, trainToMs, testFromMs, testToMs, variants });
    index += 1;
  }
  return windows;
}

export function analyzeShadowReplay(episodes: readonly ShadowEpisode[]): ShadowAnalysisReport {
  const replay = buildShadowReplayReport(episodes);
  const rows = replayCandidates(episodes);
  const cutMs = replay.trainCutMs;
  const baseline = rows.filter((r) => r.variant === "BASELINE_V1");
  const baselineAll = success(baseline);
  const baselineTest = success(baseline.filter((r) => slotToMs(r.decisionSlot) > cutMs));
  const walkForward = makeWalkForward(episodes, rows);
  const comparisons = replay.variants.map((variantReport) => {
    const vr = rows.filter((r) => r.variant === variantReport.variant);
    const test = vr.filter((r) => slotToMs(r.decisionSlot) > cutMs);
    const testSuccess = success(test);
    const asset = assetSuccessRange(rows, variantReport.variant);
    const wfPcts = walkForward.flatMap((w) =>
      w.variants
        .filter((v) => v.variant === variantReport.variant && v.testSuccessPct != null)
        .map((v) => v.testSuccessPct!),
    );
    const wfRange = wfPcts.length >= 2 ? Math.max(...wfPcts) - Math.min(...wfPcts) : null;
    const delta = pctDelta(success(vr), baselineAll);
    const testDelta = pctDelta(testSuccess, baselineTest);
    const extraTestN = variantReport.extra.test.success.n;
    const extraSuccessPct = variantReport.extra.success.pct == null ? null : variantReport.extra.success.pct * 100;
    const sufficient =
      extraTestN >= MIN_TEST_N &&
      testDelta != null &&
      testDelta >= -MATERIAL_WORSENING_PP &&
      variantReport.extra.candidates > 0;
    const insufficient = extraTestN < MIN_TEST_N || testDelta == null;
    const recommendation: ShadowComparison["recommendation"] = insufficient
      ? "INSUFFICIENT"
      : sufficient
        ? "CONTINUE"
        : "DISCARD";
    return {
      variant: variantReport.variant,
      deltaVsBaselinePp: delta,
      testDeltaVsBaselinePp: testDelta,
      additionalOpportunities: variantReport.extra.candidates,
      earlierThanBaseline: variantReport.overlap.earlierThanBaseline,
      extraDecided: variantReport.extra.decided,
      extraSuccessPct,
      extraTestN,
      testN: variantReport.test.success.n,
      assetCoverage: asset.coverage,
      assetSuccessRangePp: asset.range,
      walkForwardTestRangePp: wfRange,
      sufficientEvidence: sufficient,
      recommendation,
      evidenceLabel: evidenceLabelFor(recommendation, extraTestN),
    } satisfies ShadowComparison;
  });
  return {
    replay,
    comparisons,
    walkForward,
    variantsEvaluated: SHADOW_VARIANTS.length,
    confirmatoryAllowed: false,
    costs: analyzeShadowCosts(episodes, rows),
    horizons: buildShadowHorizonReport(episodes, rows),
  };
}
