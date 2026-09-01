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

interface BitgetCandles {
  code?: string;
  msg?: string;
  data?: string[][];
}

interface BitgetTicker {
  code?: string;
  msg?: string;
  data?: Array<{
    symbol?: string;
    lastPr?: string;
    change24h?: string;
    ts?: string;
  }>;
}

export async function fetchBitgetKlines(
  symbol: string,
  tf: Timeframe,
  limit = 400,
): Promise<TfFetch> {
  const source = `Bitget ${symbol}`;
  const url = `https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}&granularity=${INTERVAL[tf]}&limit=${limit}`;
  const res = await fetchJson<BitgetCandles>(url, { timeoutMs: 12000, retries: 1 });
  if (!res.ok || !res.data?.data || !Array.isArray(res.data.data)) {
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

export async function fetchBitgetTicker(symbol: string): Promise<QuoteFetch> {
  const source = `Bitget ${symbol}`;
  const url = `https://api.bitget.com/api/v2/mix/market/ticker?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}`;
  const res = await fetchJson<BitgetTicker>(url, { timeoutMs: 8000, retries: 1 });
  const row = res.data?.data?.[0];
  const price = row?.lastPr ? Number(row.lastPr) : null;
  if (price == null || !Number.isFinite(price)) {
    return emptyQuote(source, res.data?.msg || res.error || "ticker no disponible");
  }
  const chg = row?.change24h ? Number(row.change24h) : null;
  const ts = row?.ts ? Number(row.ts) : NaN;
  return {
    price,
    dayChangePct: chg != null && Number.isFinite(chg) ? chg * 100 : null,
    marketTime: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
    source,
    error: null,
  };
}
