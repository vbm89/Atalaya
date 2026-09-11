/**
 * Shadow-only execution cost model.
 * Unknown costs stay unknown; no broker defaults and no V1 coupling.
 */

export type ShadowFillModel = "touch" | "close_through";
export type ShadowSlippageScenario = 0 | 0.5 | 1;

export interface ShadowCostInput {
  /** Spread in price units. Null means unavailable, never zero by default. */
  spreadPrice: number | null;
  /** Commission expressed in the same price-unit scale as the trade risk. */
  commissionPrice: number | null;
  /** Risk distance in price units (|entry - SL|). */
  riskPrice: number;
}

export interface ShadowCostResult {
  known: boolean;
  costUnknown: boolean;
  spreadPrice: number | null;
  commissionPrice: number | null;
  slippagePrice: number | null;
  totalCostPrice: number | null;
  costR: number | null;
  grossR: number | null;
  netR: number | null;
}

export function shadowCostR(
  grossR: number | null,
  input: ShadowCostInput,
  slippageSpreads: ShadowSlippageScenario = 0.5,
): ShadowCostResult {
  const risk = Number.isFinite(input.riskPrice) && input.riskPrice > 0 ? input.riskPrice : null;
  const spread = finitePositiveOrNull(input.spreadPrice);
  const commission = finitePositiveOrNull(input.commissionPrice);
  if (risk == null || !Number.isFinite(grossR ?? NaN) || spread == null || commission == null) {
    return {
      known: false,
      costUnknown: true,
      spreadPrice: spread,
      commissionPrice: commission,
      slippagePrice: spread == null ? null : spread * slippageSpreads,
      totalCostPrice: null,
      costR: null,
      grossR,
      netR: null,
    };
  }
  const slippage = spread * slippageSpreads;
  const total = spread + slippage + commission;
  const costR = total / risk;
  return {
    known: true,
    costUnknown: false,
    spreadPrice: spread,
    commissionPrice: commission,
    slippagePrice: slippage,
    totalCostPrice: total,
    costR,
    grossR,
    netR: grossR! - costR,
  };
}

export interface ShadowFillObservation {
  /** Whether the bar's wick touched the level. */
  touched: boolean;
  /** Whether the bar closed through the level in the trade direction. */
  closedThrough: boolean;
}

/** A touch is not upgraded to a close-through. Missing evidence remains false. */
export function qualifiesFill(
  observation: ShadowFillObservation,
  model: ShadowFillModel,
): boolean {
  return model === "touch" ? observation.touched : observation.closedThrough;
}

function finitePositiveOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export const SHADOW_COST_PLAN = Object.freeze({
  unknownIsZero: false as const,
  fillModels: ["touch", "close_through"] as const,
  slippageScenarios: [0, 0.5, 1] as const,
  modifiesV1: false as const,
});
