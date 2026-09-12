/**
 * Formal hypothesis registry for Shadow V2 research.
 * k counts only REGISTERED or SEALED entries. Replay rows, Phase A/B variants
 * and UI cards do not increment k. TEST remains sealed until status === "SEALED".
 * Live execution is forbidden. This module does not import V1 engines.
 */
export const SHADOW_PRIMARY_METRIC = "extra_test_net_expectancy_r" as const;

export type ShadowHypothesisStatus = "REGISTERED" | "SEALED" | "LEGACY_NOT_PREREGISTERED";
export type ShadowHypothesisUniverse = "v1_map" | "independent_tape";

export interface ShadowHypothesis {
  id: string;
  label: string;
  geometry: string;
  parameters: Readonly<Record<string, string | number | boolean | null>>;
  universe: ShadowHypothesisUniverse;
  assets: "all" | readonly string[];
  primaryMetric: typeof SHADOW_PRIMARY_METRIC;
  registeredAt: string;
  status: ShadowHypothesisStatus;
}

/**
 * k=1: the first genuinely independent hypothesis after the Phase 1 integrity work.
 * Parameters are frozen before TEST is inspected. No volume/session/news filter is
 * allowed to be added later without registering a new hypothesis.
 */
export const SHADOW_HYPOTHESIS_REGISTRY: readonly ShadowHypothesis[] = Object.freeze([
  {
    id: "K1_FAILED_BREAKOUT_TRAP_15M",
    label: "Failed Breakout / Trap · 15M",
    geometry: "breakout_then_failure_reclaim",
    parameters: {
      timeframe: "15m",
      source: "market_m15",
      atrPeriodBars: 14,
      rangeLookbackBars: 16,
      breakoutCloseAtr: 0.1,
      maxFailureBars: 4,
      reclaimClose: "back_inside_prior_range",
      stopPlacement: "failed_extreme_plus_buffer",
      stopBufferAtr: 0.1,
      minRiskAtr: 0.25,
      maxRiskAtr: 2,
      tp1R: 2,
      tp2R: null,
      decision: "close_of_first_failure_reclaim",
      outcomeStarts: "next_closed_bar",
      oneCandidatePerBreakout: true,
      volumeFilter: false,
      sessionFilter: false,
      newsFilter: false,
      assetFilter: "all",
      touchAndCloseThrough: "both_research_scenarios",
      unknownCostsBlockPromotion: true,
    },
    universe: "independent_tape",
    assets: "all",
    primaryMetric: SHADOW_PRIMARY_METRIC,
    registeredAt: "2026-09-12T06:30:00Z",
    status: "REGISTERED",
  },
]);

/** Historical Shadow variants. Visible as legado; they do not count as k. */
export const SHADOW_LEGACY_HYPOTHESIS_IDS = Object.freeze([
  "BASELINE_V1",
  "VOLUME_RELAXED",
  "TRIGGER_RELAXED",
  "VOLUME_AND_TRIGGER_RELAXED",
  "ZONE_SWEEP_RECLAIM_MIN",
  "ZONE_SWEEP_RECLAIM_MID",
  "ZONE_SWEEP_RECLAIM_WIDE",
  "FVG_RETEST_FULL",
  "FVG_RETEST_PARTIAL",
  "FVG_RETEST_STRICT",
  "BREAKOUT_RETEST",
  "MOMENTUM_PULLBACK",
  "LIQUIDITY_SWEEP",
  "FVG_RETEST",
  "BREAKOUT_RETEST_15M",
] as const);

export function kHypotheses(registry: readonly ShadowHypothesis[] = SHADOW_HYPOTHESIS_REGISTRY): number {
  return registry.filter((h) => h.status === "REGISTERED" || h.status === "SEALED").length;
}

export function isHypothesisSealed(
  id: string,
  registry: readonly ShadowHypothesis[] = SHADOW_HYPOTHESIS_REGISTRY,
): boolean {
  return registry.some((h) => h.id === id && h.status === "SEALED");
}

export function isLegacyUnregistered(id: string): boolean {
  return (SHADOW_LEGACY_HYPOTHESIS_IDS as readonly string[]).includes(id);
}

export function hypothesisTestVisible(
  id: string,
  registry: readonly ShadowHypothesis[] = SHADOW_HYPOTHESIS_REGISTRY,
): boolean {
  if (isHypothesisSealed(id, registry)) return true;
  return false;
}

export const SHADOW_PREREGISTER_PLAN = Object.freeze({
  liveSignal: false as const,
  modifiesV1: false as const,
  kCountsReplayRows: false as const,
  testIsJudgeNotLeaderboard: true as const,
});
