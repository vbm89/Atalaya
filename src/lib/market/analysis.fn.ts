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

      // Shadow V2 replay is not run here: it reloads every episode and its
      // tape. Run it on demand via POST /api/learn/shadow-replay.
    } catch {
      // Research persistence is deliberately best-effort and isolated from V1.
    }

    return result;
  });
