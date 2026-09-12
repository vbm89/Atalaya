import { createServerFn } from "@tanstack/react-start";

export const getShadowRadar = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("@/lib/watch/store");
  const { buildShadowRadar } = await import("./shadow-radar");
  const { loadShadowEpisodes } = await import("./shadow-db");
  const { buildShadowIntrabarReport } = await import("./shadow-intrabar");
  const { getLatestShadowReplayReport } = await import("./shadow-replay-store");
  const { buildXauFeedComparator } = await import("./xau-feed-comparator");
  const { buildShadowAssetRanking } = await import("./shadow-asset-ranking");
  const { buildShadowFrequencyReport, buildShadowFrequencyDensity } = await import("./shadow-frequency");
  const { buildK1Report } = await import("./shadow-k1-failed-breakout");
  const { replayCandidates } = await import("./shadow-replay");
  const { kHypotheses, SHADOW_HYPOTHESIS_REGISTRY } = await import("./shadow-preregister");
  const { evaluateShadowPromotion } = await import("./shadow-promotion-gate");
  const sql = await getSql();
  const history = await createPgStore(sql).listHistory(200);
  const episodes = await loadShadowEpisodes(sql);
  const latestReplay = await getLatestShadowReplayReport(sql);
  const intrabar = await buildShadowIntrabarReport(sql, episodes);
  const xauFeeds = await buildXauFeedComparator(sql);
  const assetRanking = buildShadowAssetRanking(episodes);
  const frequency = buildShadowFrequencyReport(episodes);
  const frequencyDensity = buildShadowFrequencyDensity(episodes, replayCandidates(episodes));
  const k1Rows = await sql.query<{ asset_id: string; t: number; o: number; h: number; l: number; c: number }>(
    `select asset_id, t, o, h, l, c from market_m15 order by asset_id, t`,
  );
  const k1ByAsset: Record<string, Array<{ assetId: string; t: number; o: number; h: number; l: number; c: number }>> = {};
  for (const row of k1Rows) {
    (k1ByAsset[row.asset_id] ??= []).push({ assetId: row.asset_id, t: Number(row.t), o: row.o, h: row.h, l: row.l, c: row.c });
  }
  const k1 = buildK1Report(k1ByAsset);
  const strictPromotion = frequency.strategies.map((s) => ({
    strategy: s.strategy,
    decision: evaluateShadowPromotion({
      extraTestDecided: s.extraTestN,
      candidateDays: s.sampleDays,
      assetsWithEvidence: s.byAsset.filter((a) => a.decided > 0).length,
      positiveNetExpectancyTrain: false,
      positiveNetExpectancyTest: false,
      positiveMedianR: false,
      touchAndCloseThroughSameSign: false,
      walkForwardWindows: 0,
      walkForwardStable: false,
      bestTradeStable: false,
      bestDayStable: false,
      top3PnlShare: null,
      parameterNeighborsSameSignPct: null,
      multipleTestingAdjusted: false,
      costsKnown: false,
    }),
  }));
  return {
    radar: buildShadowRadar(history),
    latestReplay,
    intrabar,
    xauFeeds,
    assetRanking,
    frequency,
    frequencyDensity,
    k1,
    strictPromotion,
    preregister: { k: kHypotheses(SHADOW_HYPOTHESIS_REGISTRY), testIsLeaderboard: false },
  };
});
