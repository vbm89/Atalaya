import { createServerFn } from "@tanstack/react-start";

export const getShadowRadar = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("@/lib/watch/store");
  const { buildShadowRadar } = await import("./shadow-radar");
  const { loadShadowEpisodes } = await import("./shadow-db");
  const { buildShadowIntrabarReport } = await import("./shadow-intrabar");
  const { getLatestShadowReplayReport } = await import("./shadow-replay-store");
  const sql = await getSql();
  const history = await createPgStore(sql).listHistory(200);
  const episodes = await loadShadowEpisodes(sql);
  const latestReplay = await getLatestShadowReplayReport(sql);
  const intrabar = await buildShadowIntrabarReport(sql, episodes);
  return { radar: buildShadowRadar(history), latestReplay, intrabar };
});
