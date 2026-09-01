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
  "5m": "5min",
  "15m": "15min",
  "1h": "1h",
  "4h": "4h",
};

interface TwelveSeries {
  status?: string;
  code?: number;
  message?: string;
  meta?: { symbol?: string; exchange?: string };
  values?: Array<{
    datetime?: string;
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
  }>;
}

interface TwelveQuote {
  status?: string;
  code?: number;
  message?: string;
  symbol?: string;
  close?: string;
  datetime?: string;
  percent_change?: string;
}

export function twelveDataKey(): string | null {
  const key = process.env.TWELVEDATA_API_KEY;
  return key && key.length > 8 ? key : null;
}

export async function fetchTwelveKlines(
  symbol: string,
  tf: Timeframe,
  outputsize = 400,
): Promise<TfFetch> {
  const source = `Twelve Data ${symbol}`;
  const key = twelveDataKey();
  if (!key) return emptyTf(source, "sin API key");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${INTERVAL[tf]}&outputsize=${outputsize}&apikey=${encodeURIComponent(key)}`;
  const res = await fetchJson<TwelveSeries>(url, { timeoutMs: 12000, retries: 0 });
  const values = res.data?.values;
  if (!res.ok || !Array.isArray(values) || values.length === 0) {
    return emptyTf(source, res.data?.message || res.error || `HTTP ${res.status}`);
  }
  const candles = values
    .map((v) => {
      const t = v.datetime ? Date.parse(v.datetime.replace(" ", "T") + "Z") : NaN;
      return {
        time: Math.floor(t / 1000),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: v.volume != null ? Number(v.volume) : null,
      };
    })
    .filter(finiteCandle)
    .sort((a, b) => a.time - b.time);
  return {
    candles,
    source,
    error: candles.length ? null : "serie vacía",
  };
}

export async function fetchTwelveQuote(symbol: string): Promise<QuoteFetch> {
  const source = `Twelve Data ${symbol}`;
  const key = twelveDataKey();
  if (!key) return emptyQuote(source, "sin API key");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetchJson<TwelveQuote>(url, { timeoutMs: 8000, retries: 0 });
  const price = res.data?.close ? Number(res.data.close) : null;
  if (price == null || !Number.isFinite(price)) {
    return emptyQuote(source, res.data?.message || res.error || "ticker no disponible");
  }
  const chg = res.data?.percent_change ? Number(res.data.percent_change) : null;
  const dt = res.data?.datetime
    ? new Date(res.data.datetime.replace(" ", "T") + "Z").toISOString()
    : new Date().toISOString();
  return {
    price,
    dayChangePct: chg != null && Number.isFinite(chg) ? chg : null,
    marketTime: dt,
    source,
    error: null,
  };
}
