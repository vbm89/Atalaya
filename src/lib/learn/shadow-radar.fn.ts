import { createServerFn } from "@tanstack/react-start";

export const getShadowRadar = createServerFn({ method: "POST" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const { createPgStore } = await import("@/lib/watch/store");
  const { buildShadowRadar } = await import("./shadow-radar");
  const { getLatestShadowReplayReport } = await import("./shadow-replay-store");
  const sql = await getSql();
  const history = await createPgStore(sql).listHistory(200);
  const latestReplay = await getLatestShadowReplayReport(sql);
  return { radar: buildShadowRadar(history), latestReplay };
});
