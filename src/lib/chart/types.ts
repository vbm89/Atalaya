import type { AssetId, Candle, InstrumentKind } from "@/lib/trading/types";

export type ChartTf =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "4h"
  | "1d"
  | "1w"
  | "1M";

export const CHART_TFS: { id: ChartTf; label: string }[] = [
  { id: "1m", label: "M1" },
  { id: "5m", label: "M5" },
  { id: "15m", label: "M15" },
  { id: "30m", label: "M30" },
  { id: "1h", label: "H1" },
  { id: "4h", label: "H4" },
  { id: "1d", label: "D1" },
  { id: "1w", label: "W1" },
  { id: "1M", label: "MN1" },
];

export const CHART_TF_IDS = CHART_TFS.map((t) => t.id) as ChartTf[];

export function chartTfLabel(tf: ChartTf): string {
  return CHART_TFS.find((t) => t.id === tf)?.label ?? tf;
}

export type ChartStreamKind = "binance" | "bitget";

export type LiveStatus = "connecting" | "live" | "closed" | "offline";

export interface ChartSeries {
  assetId: AssetId;
  tf: ChartTf;
  candles: Candle[];
  source: string | null;
  feedSymbol: string;
  venue: string;
  instrumentKind: InstrumentKind;
  proxyNote: string | null;
  sessionOpen: boolean;
  sessionLabel: string;
  lastBarAt: string | null;
  volumeAvailable: boolean;
  error: string | null;
  digits: number;
  streamKind: ChartStreamKind | null;
  streamSymbol: string | null;
}

export interface ChartOverlays {
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  rsi: boolean;
  volume: boolean;
}

export const DEFAULT_OVERLAYS: ChartOverlays = {
  ema20: false,
  ema50: false,
  ema200: false,
  rsi: false,
  volume: false,
};
