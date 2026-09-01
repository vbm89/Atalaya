import { createServerFn } from "@tanstack/react-start";
import type { AssetId } from "@/lib/trading/types";
import { CHART_TF_IDS, type ChartTf } from "@/lib/chart/types";

const ASSET_IDS: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];

function parse(input: { assetId: AssetId; tf: ChartTf }) {
  if (!input || !ASSET_IDS.includes(input.assetId) || !CHART_TF_IDS.includes(input.tf)) {
    throw new Error("Parámetros de gráfico no válidos");
  }
  return input;
}

export const getChartSeries = createServerFn({ method: "POST" })
  .validator(parse)
  .handler(async ({ data }) => {
    const { loadChartSeries } = await import("./chart-feed");
    return loadChartSeries(data.assetId, data.tf);
  });

export const getChartTick = createServerFn({ method: "POST" })
  .validator(parse)
  .handler(async ({ data }) => {
    const { loadChartLast } = await import("./chart-feed");
    return loadChartLast(data.assetId, data.tf);
  });
