import { createServerFn } from "@tanstack/react-start";
import type { AssetId } from "@/lib/trading/types";
import { bitgetLivePrice } from "@/lib/chart/stream";
import { fetchJson } from "./http";

const INST: Record<string, AssetId> = {
  XAUUSDT: "XAUUSD",
  BTCUSDT: "BTCUSD",
  NDX100USDT: "US100",
  CLUSDT: "WTI",
};

interface BitgetTickers {
  data?: Array<{
    symbol?: string;
    instId?: string;
    lastPr?: string;
    last?: string;
    markPrice?: string;
    bidPr?: string;
    askPr?: string;
    indexPrice?: string;
  }>;
}

/** Visual-only REST snapshot of Bitget tickers. Does not feed V1. */
export const getVisualTickers = createServerFn({ method: "POST" }).handler(async () => {
  const url = "https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES";
  const res = await fetchJson<BitgetTickers>(url, { timeoutMs: 8000, retries: 1 });
  const out: Partial<Record<AssetId, number>> = {};
  for (const row of res.data?.data ?? []) {
    const instId = row.instId || row.symbol || "";
    const id = INST[instId];
    if (!id) continue;
    const price = bitgetLivePrice(row, instId);
    if (price != null) out[id] = price;
  }
  return out;
});
