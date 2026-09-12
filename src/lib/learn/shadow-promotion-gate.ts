/**
 * Shadow V2 promotion protocol, research-only.
 * This is intentionally stricter than the current evidence classifier.
 * It never executes a signal and never changes V1.
 */

export const SHADOW_PROMOTION_MIN_EXTRA_TEST = 80;
export const SHADOW_PROMOTION_MIN_DAYS = 40;
export const SHADOW_PROMOTION_MIN_WALK_FORWARD_WINDOWS = 3;
export const SHADOW_PROMOTION_MAX_TOP3_PNL_SHARE = 0.4;

export interface ShadowPromotionInput {
  extraTestDecided: number;
  candidateDays: number;
  assetsWithEvidence: number;
  positiveNetExpectancyTrain: boolean;
  positiveNetExpectancyTest: boolean;
  positiveMedianR: boolean;
  touchAndCloseThroughSameSign: boolean;
  walkForwardWindows: number;
  walkForwardStable: boolean;
  bestTradeStable: boolean;
  bestDayStable: boolean;
  top3PnlShare: number | null;
  parameterNeighborsSameSignPct: number | null;
  multipleTestingAdjusted: boolean;
  costsKnown: boolean;
}

export interface ShadowPromotionDecision {
  eligible: boolean;
  status: "RESEARCH" | "NOT_READY";
  reasons: string[];
}

/**
 * Promotion remains locked unless every pre-declared robustness gate passes.
 * This function is a gate, not an optimizer: it never searches thresholds.
 */
export function evaluateShadowPromotion(input: ShadowPromotionInput): ShadowPromotionDecision {
  const reasons: string[] = [];
  if (input.extraTestDecided < SHADOW_PROMOTION_MIN_EXTRA_TEST) reasons.push("EXTRA TEST < 80");
  if (input.candidateDays < SHADOW_PROMOTION_MIN_DAYS) reasons.push("< 40 días con candidatos");
  if (input.assetsWithEvidence < 2) reasons.push("evidencia en menos de 2 activos");
  if (!input.positiveNetExpectancyTrain) reasons.push("TRAIN neto no positivo");
  if (!input.positiveNetExpectancyTest) reasons.push("TEST neto no positivo");
  if (!input.positiveMedianR) reasons.push("mediana R no positiva");
  if (!input.touchAndCloseThroughSameSign) reasons.push("touch vs close-through cambia de signo");
  if (input.walkForwardWindows < SHADOW_PROMOTION_MIN_WALK_FORWARD_WINDOWS) reasons.push("< 3 ventanas walk-forward");
  if (!input.walkForwardStable) reasons.push("walk-forward inestable");
  if (!input.bestTradeStable) reasons.push("concentración en mejor trade");
  if (!input.bestDayStable) reasons.push("concentración en mejor día");
  if (input.top3PnlShare == null || input.top3PnlShare >= SHADOW_PROMOTION_MAX_TOP3_PNL_SHARE) reasons.push("top 3 trades concentran ≥ 40% del PnL");
  if (input.parameterNeighborsSameSignPct == null || input.parameterNeighborsSameSignPct < 70) reasons.push("< 70% de vecinos de parámetros con mismo signo");
  if (!input.multipleTestingAdjusted) reasons.push("múltiples pruebas sin ajuste");
  if (!input.costsKnown) reasons.push("costes desconocidos");
  return { eligible: reasons.length === 0, status: reasons.length === 0 ? "RESEARCH" : "NOT_READY", reasons };
}

export const SHADOW_PROMOTION_PLAN = Object.freeze({
  modifiesV1: false as const,
  liveSignal: false as const,
  automaticPromotion: false as const,
  minimumExtraTest: SHADOW_PROMOTION_MIN_EXTRA_TEST,
  minimumDays: SHADOW_PROMOTION_MIN_DAYS,
  minimumWalkForwardWindows: SHADOW_PROMOTION_MIN_WALK_FORWARD_WINDOWS,
});
