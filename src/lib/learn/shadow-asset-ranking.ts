import { replayCandidates, type ShadowCandidateReason, type ShadowCandidateResult, type ShadowEpisode } from "./shadow-replay";
import { MIN_TEST_N } from "./shadow-analysis";
import { decisionCutMs, decisionTimesFromSlots } from "./shadow-lab-clock";

export interface ShadowAssetMethodRanking {
  assetId: string;
  variant: ShadowCandidateReason;
  candidates: number;
  decided: number;
  successPct: number | null;
  meanR: number | null;
  extra: number;
  extraDecided: number;
  extraSuccessPct: number | null;
  earlierThanV1: number;
  evidence: "INSUFFICIENT" | "DESCRIPTIVE" | "EXPLORATORY";
}

export interface ShadowAssetRanking {
  assetId: string;
  methods: ShadowAssetMethodRanking[];
  best: ShadowAssetMethodRanking | null;
}

function decided(rows: readonly ShadowCandidateResult[]) {
  return rows.filter((r) => r.outcome === "tp1" || r.outcome === "tp2" || r.outcome === "sl");
}

function success(rows: readonly ShadowCandidateResult[]) {
  const d = decided(rows);
  if (!d.length) return null;
  return (d.filter((r) => r.outcome === "tp1" || r.outcome === "tp2").length / d.length) * 100;
}

function meanR(rows: readonly ShadowCandidateResult[]) {
  const values = decided(rows).map((r) => r.rrAtOutcome).filter((v): v is number => v != null && Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function isV1Entry(ep: ShadowEpisode | undefined) {
  return ep?.events.some((e) => e.toState === "entry") ?? false;
}

/**
 * Per-asset Shadow methods. TEST is a sample-size gate, never a leaderboard.
 * No champion is elected. Live selection is forbidden.
 */
export function buildShadowAssetRanking(episodes: readonly ShadowEpisode[]) {
  const rows = replayCandidates(episodes);
  const variants = [...new Set(rows.map((r) => r.variant))].sort();
  const assets = [...new Set(rows.map((r) => r.features.assetId))].sort();
  const episodeById = new Map(episodes.map((ep) => [ep.case.episodeId, ep]));
  const cutMs = decisionCutMs(decisionTimesFromSlots(rows.map((r) => r.decisionSlot)));

  const rankings: ShadowAssetRanking[] = assets.map((assetId) => {
    const methods = variants
      .map((variant) => {
        const all = rows.filter((r) => r.variant === variant && r.features.assetId === assetId);
        const extra = all.filter((r) => !isV1Entry(episodeById.get(r.episodeId)));
        const overlap = all.filter((r) => isV1Entry(episodeById.get(r.episodeId)));
        const extraTest = extra.filter((r) => r.decisionSlot * 1000 > cutMs);
        const extraTestN = decided(extraTest).length;
        const evidence = extraTestN >= MIN_TEST_N ? "EXPLORATORY" : "INSUFFICIENT";
        return {
          assetId,
          variant,
          candidates: all.length,
          decided: decided(all).length,
          successPct: success(all),
          meanR: meanR(all),
          extra: extra.length,
          extraDecided: decided(extra).length,
          extraSuccessPct: success(extra),
          earlierThanV1: overlap.filter((r) => {
            const ep = episodeById.get(r.episodeId);
            const baseline = ep?.events.find((e) => e.toState === "entry");
            return baseline != null && r.decisionSlot < baseline.atMs / 1000;
          }).length,
          evidence,
        } satisfies ShadowAssetMethodRanking;
      })
      .filter((m) => m.candidates > 0)
      .sort((a, b) => a.variant.localeCompare(b.variant));

    return { assetId, methods, best: null };
  });

  return rankings;
}

