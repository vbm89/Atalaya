import type { ShadowCandidateReason, ShadowCandidateResult, ShadowEpisode, ShadowOutcome } from "./shadow-replay";
import { SHADOW_VARIANTS, replayCandidates } from "./shadow-replay";
import { shadowCostR, type ShadowCostInput, type ShadowFillModel, type ShadowSlippageScenario } from "./shadow-costs";

export interface ShadowAssetCostConfig extends ShadowCostInput {
  assetId: string;
}

export interface ShadowCostScenarioSummary {
  fillModel: ShadowFillModel;
  slippageSpreads: ShadowSlippageScenario;
  known: boolean;
  costUnknown: boolean;
  decided: number;
  grossExpectancyR: number | null;
  netExpectancyR: number | null;
  meanCostR: number | null;
}

export interface ShadowVariantCostSummary {
  variant: ShadowCandidateReason;
  scenarios: ShadowCostScenarioSummary[];
}

export interface ShadowCostAnalysisReport {
  costsKnown: boolean;
  configuredAssets: string[];
  unknownAssets: string[];
  variants: ShadowVariantCostSummary[];
  limitations: string[];
}

export interface ShadowCostAnalysisConfig {
  assets?: readonly ShadowAssetCostConfig[];
  /** Fixed scenarios only; never selected from TEST. */
  slippageSpreads?: readonly ShadowSlippageScenario[];
}

function grossRFor(outcome: ShadowOutcome, ep: ShadowEpisode): number | null {
  const c = ep.case;
  const risk = Math.abs(c.entry - c.sl);
  if (!(risk > 0)) return null;
  if (outcome === "sl") return -1;
  if (outcome === "tp1") return Math.abs(c.tp1 - c.entry) / risk;
  if (outcome === "tp2" && c.tp2 != null) return Math.abs(c.tp2 - c.entry) / risk;
  return null;
}

function closeThrough(outcome: ShadowOutcome, candidate: ShadowCandidateResult, ep: ShadowEpisode): ShadowOutcome {
  const c = ep.case;
  const bars = ep.bars
    .filter((b) => b.tf === "15m" && b.t > candidate.decisionSlot)
    .sort((a, b) => a.t - b.t);
  for (const b of bars) {
    const sl = c.direction === "sell" ? b.c >= c.sl : b.c <= c.sl;
    const tp1 = c.direction === "sell" ? b.c <= c.tp1 : b.c >= c.tp1;
    const tp2 = c.tp2 != null && (c.direction === "sell" ? b.c <= c.tp2 : b.c >= c.tp2);
    if (sl) return "sl";
    if (tp1) return "tp1";
    if (tp2) return "tp2";
  }
  return ep.case.closedAtMs != null ? "expired" : "pending";
}

function decided(outcome: ShadowOutcome): boolean {
  return outcome === "tp1" || outcome === "tp2" || outcome === "sl";
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function analyzeShadowCosts(
  episodes: readonly ShadowEpisode[],
  rows: readonly ShadowCandidateResult[] = replayCandidates(episodes),
  config: ShadowCostAnalysisConfig = {},
): ShadowCostAnalysisReport {
  const byEpisode = new Map(episodes.map((ep) => [ep.case.episodeId, ep]));
  const assets = new Map((config.assets ?? []).map((x) => [x.assetId, x]));
  const scenarios = config.slippageSpreads?.length ? [...config.slippageSpreads] : [0, 0.5, 1];
  const variants: ShadowVariantCostSummary[] = SHADOW_VARIANTS.map((variant) => {
    const vr = rows.filter((r) => r.variant === variant);
    const scenarioRows: ShadowCostScenarioSummary[] = [];
    for (const fillModel of ["touch", "close_through"] as const) {
      const resolved = fillModel === "touch"
        ? vr
        : vr.map((r) => {
            const ep = byEpisode.get(r.episodeId);
            return ep ? { ...r, outcome: closeThrough(r.outcome, r, ep) } : r;
          });
      for (const slippageSpreads of scenarios) {
        const results = resolved.filter((r) => decided(r.outcome));
        const costs = results.map((r) => {
          const ep = byEpisode.get(r.episodeId);
          const input = ep ? assets.get(ep.case.assetId) : undefined;
          return shadowCostR(
            grossRFor(r.outcome, ep!),
            input ? { spreadPrice: input.spreadPrice, commissionPrice: input.commissionPrice, riskPrice: input.riskPrice } : { spreadPrice: null, commissionPrice: null, riskPrice: ep ? Math.abs(ep.case.entry - ep.case.sl) : 0 },
            slippageSpreads,
          );
        });
        const known = costs.length > 0 && costs.every((x) => x.known);
        scenarioRows.push({
          fillModel,
          slippageSpreads,
          known,
          costUnknown: !known,
          decided: results.length,
          grossExpectancyR: mean(costs.map((x) => x.grossR).filter((x): x is number => x != null)),
          netExpectancyR: known ? mean(costs.map((x) => x.netR).filter((x): x is number => x != null)) : null,
          meanCostR: known ? mean(costs.map((x) => x.costR).filter((x): x is number => x != null)) : null,
        });
      }
    }
    return { variant, scenarios: scenarioRows };
  });
  const configuredAssets = [...assets.keys()].sort();
  const observedAssets = [...new Set(episodes.map((e) => e.case.assetId))].sort();
  const unknownAssets = observedAssets.filter((assetId) => !assets.has(assetId));
  return {
    costsKnown: variants.every((v) => v.scenarios.every((s) => s.known || s.decided === 0)),
    configuredAssets,
    unknownAssets,
    variants,
    limitations: [
      "Los costes no configurados permanecen desconocidos; nunca se convierten en cero.",
      "Touch usa el primer toque histórico existente; close-through exige cierre de vela atravesando el nivel y no promociona un wick como fill.",
      "Los escenarios de slippage (0/0,5/1 spread) son fijos y no se optimizan contra TEST.",
      "Sin spread/commission/risk por activo no se calcula netR y la promoción permanece bloqueada.",
    ],
  };
}
