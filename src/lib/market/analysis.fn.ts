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
      await recordDailyForecasts(getSql(), result.assets, forecastAll(result.assets, generatedAt), generatedAt);
    } catch {
      // Research persistence is deliberately best-effort and isolated from V1.
    }

    return result;
  });
