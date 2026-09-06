import { createServerFn } from "@tanstack/react-start";

export const getMarketAnalysis = createServerFn({ method: "POST" })
  .validator((input: { force?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { runMarketAnalysis } = await import("./run-analysis");
    const result = await runMarketAnalysis(Boolean(data.force));

    // Shadow-only observation layer. Failure to persist research data must never
    // make the V1 market analysis fail or alter its output.
    try {
      const { forecastAll } = await import("@/lib/learn/day-forecast");
      const { recordDailyForecasts } = await import("@/lib/learn/day-forecast-store");
      const { getSql } = await import("@/lib/db");
      const generatedAt = result.generatedAt;
      const sql = getSql();
      await recordDailyForecasts(sql, result.assets, forecastAll(result.assets, generatedAt), generatedAt);

      // Shadow V2 replay: rebuild the historical evidence, analyze it, and
      // persist the report on every normal analysis cycle. This is strictly
      // research data; it never feeds the V1 decision path.
      if ((process.env.SHADOW_REPLAY_ENABLED?.trim() ?? "") === "true") {
        const { loadShadowEpisodes } = await import("@/lib/learn/shadow-db");
        const { analyzeShadowReplay } = await import("@/lib/learn/shadow-analysis");
        const { saveShadowReplayReport } = await import("@/lib/learn/shadow-replay-store");
        const episodes = await loadShadowEpisodes(sql);
        const report = analyzeShadowReplay(episodes);
        await saveShadowReplayReport(sql, report, generatedAt);
      }
    } catch {
      // Research persistence is deliberately best-effort and isolated from V1.
    }

    return result;
  });
