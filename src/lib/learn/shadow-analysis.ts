import type {
  ShadowCandidateReason,
  ShadowCandidateResult,
  ShadowEpisode,
  ShadowReplayReport,
} from "./shadow-replay";
import { SHADOW_VARIANTS, replayCandidates, buildShadowReplayReport } from "./shadow-replay";

export interface ShadowComparison {
  variant: ShadowCandidateReason;
  deltaVsBaselinePp: number | null;
  testDeltaVsBaselinePp: number | null;
  additionalOpportunities: number;
  testN: number;
  assetCoverage: number;
  assetSuccessRangePp: number | null;
  walkForwardTestRangePp: number | null;
  sufficientEvidence: boolean;
  recommendation: "CONTINUE" | "DISCARD" | "INSUFFICIENT";
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
}

const MIN_TEST_N = 30;
const MATERIAL_WORSENING_PP = 5;

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
  const ordered = [...episodes].sort((a, b) => a.case.openedAtMs - b.case.openedAtMs);
  if (ordered.length < 10) return [];
  const block = Math.max(1, Math.floor(ordered.length * 0.2));
  const trainSize = block * 3;
  const windows: WalkForwardWindow[] = [];
  let index = 0;
  for (let trainEnd = trainSize; trainEnd + block <= ordered.length; trainEnd += block) {
    const trainFromMs = ordered[0]!.case.openedAtMs;
    const trainToMs = ordered[trainEnd - 1]!.case.openedAtMs;
    const testFromMs = ordered[trainEnd]!.case.openedAtMs;
    const testToMs = ordered[Math.min(trainEnd + block - 1, ordered.length - 1)]!.case.openedAtMs;
    const variants = SHADOW_VARIANTS.map((variant) => {
      const vr = rows.filter((r) => r.variant === variant);
      const train = vr.filter((r) => r.decisionSlot * 1000 >= trainFromMs && r.decisionSlot * 1000 <= trainToMs);
      const test = vr.filter((r) => r.decisionSlot * 1000 >= testFromMs && r.decisionSlot * 1000 <= testToMs);
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
  const ordered = [...episodes].sort((a, b) => a.case.openedAtMs - b.case.openedAtMs);
  const cutMs = ordered[Math.floor(ordered.length * 0.7) - 1]?.case.openedAtMs ?? Number.POSITIVE_INFINITY;
  const baseline = rows.filter((r) => r.variant === "BASELINE_V1");
  const baselineAll = success(baseline);
  const baselineTest = success(baseline.filter((r) => r.decisionSlot * 1000 > cutMs));
  const walkForward = makeWalkForward(episodes, rows);
  const comparisons = replay.variants.map((variantReport) => {
    const vr = rows.filter((r) => r.variant === variantReport.variant);
    const test = vr.filter((r) => r.decisionSlot * 1000 > cutMs);
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
    const sufficient =
      variantReport.test.decided >= MIN_TEST_N &&
      testDelta != null &&
      testDelta >= -MATERIAL_WORSENING_PP &&
      variantReport.additionalOpportunities > 0;
    const insufficient = variantReport.test.decided < MIN_TEST_N || testDelta == null;
    return {
      variant: variantReport.variant,
      deltaVsBaselinePp: delta,
      testDeltaVsBaselinePp: testDelta,
      additionalOpportunities: variantReport.additionalOpportunities,
      testN: variantReport.test.decided,
      assetCoverage: asset.coverage,
      assetSuccessRangePp: asset.range,
      walkForwardTestRangePp: wfRange,
      sufficientEvidence: sufficient,
      recommendation: insufficient ? "INSUFFICIENT" : sufficient ? "CONTINUE" : "DISCARD",
    } satisfies ShadowComparison;
  });
  return { replay, comparisons, walkForward };
}
