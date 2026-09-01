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
  "5m": "Min5",
  "15m": "Min15",
  "1h": "Min60",
  "4h": "Hour4",
};

interface MexcKline {
  success?: boolean;
  code?: number;
  data?: {
    time?: number[];
    open?: number[];
    high?: number[];
    low?: number[];
    close?: number[];
    vol?: number[];
  };
}

interface MexcTicker {
  success?: boolean;
  data?: {
    lastPrice?: number;
    riseFallRate?: number;
    timestamp?: number;
  };
}

export async function fetchMexcKlines(
  symbol: string,
  tf: Timeframe,
): Promise<TfFetch> {
  const source = `MEXC ${symbol}`;
  const url = `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(symbol)}?interval=${INTERVAL[tf]}`;
  const res = await fetchJson<MexcKline>(url, { timeoutMs: 14000, retries: 1 });
  const d = res.data?.data;
  if (!res.ok || !d?.time?.length || !d.close?.length) {
    return emptyTf(source, res.error || `HTTP ${res.status}`);
  }
  const n = Math.min(d.time.length, d.open?.length ?? 0, d.high?.length ?? 0, d.low?.length ?? 0, d.close.length);
  const start = Math.max(0, n - 500);
  const candles = [];
  for (let i = start; i < n; i++) {
    const t = Number(d.time[i]);
    candles.push({
      time: t > 1e12 ? Math.floor(t / 1000) : t,
      open: Number(d.open![i]),
      high: Number(d.high![i]),
      low: Number(d.low![i]),
      close: Number(d.close[i]),
      volume: d.vol?.[i] != null ? Number(d.vol[i]) : null,
    });
  }
  const clean = candles.filter(finiteCandle).sort((a, b) => a.time - b.time);
  return {
    candles: clean,
    source,
    error: clean.length ? null : "serie vacía",
  };
}

export async function fetchMexcTicker(symbol: string): Promise<QuoteFetch> {
  const source = `MEXC ${symbol}`;
  const url = `https://contract.mexc.com/api/v1/contract/ticker?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetchJson<MexcTicker>(url, { timeoutMs: 8000, retries: 1 });
  const row = res.data?.data;
  const price = row?.lastPrice != null ? Number(row.lastPrice) : null;
  if (price == null || !Number.isFinite(price)) {
    return emptyQuote(source, res.error || "ticker no disponible");
  }
  const rate = row?.riseFallRate != null ? Number(row.riseFallRate) : null;
  const ts = row?.timestamp != null ? Number(row.timestamp) : NaN;
  return {
    price,
    dayChangePct: rate != null && Number.isFinite(rate) ? rate * 100 : null,
    marketTime: Number.isFinite(ts)
      ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString()
      : new Date().toISOString(),
    source,
    error: null,
  };
}
