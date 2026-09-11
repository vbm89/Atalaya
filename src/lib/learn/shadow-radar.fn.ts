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
  const { replayCandidates } = await import("./shadow-replay");
  const { kHypotheses, SHADOW_HYPOTHESIS_REGISTRY } = await import("./shadow-preregister");
  const sql = await getSql();
  const history = await createPgStore(sql).listHistory(200);
  const episodes = await loadShadowEpisodes(sql);
  const latestReplay = await getLatestShadowReplayReport(sql);
  const intrabar = await buildShadowIntrabarReport(sql, episodes);
  const xauFeeds = await buildXauFeedComparator(sql);
  const assetRanking = buildShadowAssetRanking(episodes);
  const frequency = buildShadowFrequencyReport(episodes);
  const frequencyDensity = buildShadowFrequencyDensity(episodes, replayCandidates(episodes));
  return { radar: buildShadowRadar(history), latestReplay, intrabar, xauFeeds, assetRanking, frequency, frequencyDensity, preregister: { k: kHypotheses(SHADOW_HYPOTHESIS_REGISTRY), testIsLeaderboard: false } };
});
