import { replayCandidates, type ShadowCandidateReason, type ShadowCandidateResult, type ShadowEpisode } from "./shadow-replay";
import { MIN_TEST_N } from "./shadow-analysis";

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
 * Asset-specific descriptive ranking. It never feeds V1 and never chooses a live method.
 * A method is only considered "evidenced" after 30 EXTRA TEST decisions; until then it is insufficient.
 */
export function buildShadowAssetRanking(episodes: readonly ShadowEpisode[]) {
  const rows = replayCandidates(episodes);
  const variants = [...new Set(rows.map((r) => r.variant))];
  const assets = [...new Set(rows.map((r) => r.features.assetId))];
  const episodeById = new Map(episodes.map((ep) => [ep.case.id, ep]));
  const ordered = [...episodes].sort((a, b) => a.case.openedAtMs - b.case.openedAtMs);
  const cutMs = ordered[Math.floor(ordered.length * 0.7) - 1]?.case.openedAtMs ?? Number.POSITIVE_INFINITY;

  const rankings: ShadowAssetRanking[] = assets.map((assetId) => {
    const methods = variants.map((variant) => {
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
    }).filter((m) => m.candidates > 0);

    const best = [...methods].sort((a, b) => {
      const ae = a.evidence === "INSUFFICIENT" ? 0 : 1;
      const be = b.evidence === "INSUFFICIENT" ? 0 : 1;
      if (be !== ae) return be - ae;
      if ((b.meanR ?? -Infinity) !== (a.meanR ?? -Infinity)) return (b.meanR ?? -Infinity) - (a.meanR ?? -Infinity);
      if ((b.successPct ?? -Infinity) !== (a.successPct ?? -Infinity)) return (b.successPct ?? -Infinity) - (a.successPct ?? -Infinity);
      return b.decided - a.decided;
    })[0] ?? null;

    return { assetId, methods: methods.sort((a, b) => (b.meanR ?? -Infinity) - (a.meanR ?? -Infinity)), best };
  });

  return rankings;
}
