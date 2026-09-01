import type { Timeframe } from "@/lib/trading/types";
import { fetchJson } from "./http";
import {
  emptyQuote,
  emptyTf,
  finiteCandle,
  type QuoteFetch,
  type TfFetch,
} from "./series";

const INTERVAL: Record<Timeframe, string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
};

interface OkxCandles {
  code?: string;
  msg?: string;
  data?: string[][];
}

interface OkxTicker {
  code?: string;
  msg?: string;
  data?: Array<{
    last?: string;
    open24h?: string;
    ts?: string;
  }>;
}

export async function fetchOkxKlines(
  instId: string,
  tf: Timeframe,
  limit = 300,
): Promise<TfFetch> {
  const source = `OKX ${instId}`;
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${INTERVAL[tf]}&limit=${limit}`;
  const res = await fetchJson<OkxCandles>(url, { timeoutMs: 12000, retries: 1 });
  if (!res.ok || !res.data?.data || !Array.isArray(res.data.data) || res.data.data.length === 0) {
    return emptyTf(source, res.data?.msg || res.error || `HTTP ${res.status}`);
  }
  const candles = res.data.data
    .map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }))
    .filter(finiteCandle);
  candles.sort((a, b) => a.time - b.time);
  return {
    candles,
    source,
    error: candles.length ? null : "serie vacía",
  };
}

export async function fetchOkxTicker(instId: string): Promise<QuoteFetch> {
  const source = `OKX ${instId}`;
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;
  const res = await fetchJson<OkxTicker>(url, { timeoutMs: 8000, retries: 1 });
  const row = res.data?.data?.[0];
  const price = row?.last ? Number(row.last) : null;
  if (price == null || !Number.isFinite(price)) {
    return emptyQuote(source, res.data?.msg || res.error || "ticker no disponible");
  }
  const open = row?.open24h ? Number(row.open24h) : null;
  const ts = row?.ts ? Number(row.ts) : NaN;
  return {
    price,
    dayChangePct:
      open && Number.isFinite(open) && open !== 0 ? ((price - open) / open) * 100 : null,
    marketTime: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
    source,
    error: null,
  };
}
