import type { Candle, Timeframe } from "@/lib/trading/types";
import { fetchJson, sleep } from "./http";
import { emptyQuote, emptyTf, finiteCandle, type QuoteFetch, type TfFetch } from "./series";

interface YahooChart {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice?: number;
        regularMarketChangePercent?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
        dataGranularity?: string;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

export interface QuoteSeries {
  symbol: string;
  price: number | null;
  dayChangePct: number | null;
  marketTime: string | null;
  candles: Candle[];
  error: string | null;
}

let queue: Promise<unknown> = Promise.resolve();
let cooldownUntil = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const YF_RANGE: Record<Exclude<Timeframe, "4h">, { interval: string; range: string }> = {
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "60m", range: "3mo" },
};

export async function fetchYahooTf(symbol: string, tf: Timeframe): Promise<TfFetch> {
  const source = `Yahoo Finance ${symbol}`;
  if (tf === "4h") {
    return emptyTf(source, "Yahoo no ofrece velas nativas de 4h");
  }
  const spec = YF_RANGE[tf];
  const series = await fetchYahooChart(symbol, spec.interval as "5m" | "15m" | "60m", spec.range as "5d" | "1mo" | "3mo");
  return {
    candles: series.candles,
    source,
    error: series.error,
  };
}

export async function fetchYahooQuote(symbol: string): Promise<QuoteFetch> {
  const source = `Yahoo Finance ${symbol}`;
  const series = await fetchYahooChart(symbol, "5m", "1d");
  if (series.price == null) {
    return emptyQuote(source, series.error ?? "sin precio");
  }
  return {
    price: series.price,
    dayChangePct: series.dayChangePct,
    marketTime: series.marketTime,
    source,
    error: series.error,
  };
}

export async function fetchYahooChart(
  symbol: string,
  interval: "5m" | "15m" | "60m" | "1d",
  range: "1d" | "5d" | "1mo" | "3mo",
): Promise<QuoteSeries> {
  return enqueue(() => fetchYahooChartUnqueued(symbol, interval, range));
}

async function fetchYahooChartUnqueued(
  symbol: string,
  interval: "5m" | "15m" | "60m" | "1d",
  range: "1d" | "5d" | "1mo" | "3mo",
): Promise<QuoteSeries> {
  if (Date.now() < cooldownUntil) {
    return empty(symbol, "Yahoo en pausa por límite de peticiones");
  }
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=${interval}&range=${range}&includePrePost=false`;
  const res = await fetchJson<YahooChart>(url, { timeoutMs: 12000, retries: 0 });
  if (res.status === 429) {
    cooldownUntil = Date.now() + 90_000;
    return empty(symbol, "Yahoo 429");
  }
  if (!res.ok || !res.data) {
    return empty(symbol, res.error ?? `HTTP ${res.status}`);
  }
  const result = res.data.chart.result?.[0];
  if (!result) {
    return empty(symbol, res.data.chart.error?.description ?? "sin series");
  }
  const q = result.indicators.quote?.[0];
  const ts = result.timestamp ?? [];
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q?.close?.[i];
    const open = q?.open?.[i];
    const high = q?.high?.[i];
    const low = q?.low?.[i];
    if (
      close == null ||
      open == null ||
      high == null ||
      low == null ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    const vol = q?.volume?.[i];
    const c: Candle = {
      time: ts[i]!,
      open,
      high,
      low,
      close,
      volume: vol != null && Number.isFinite(vol) ? vol : null,
    };
    if (finiteCandle(c)) candles.push(c);
  }
  const meta = result.meta;
  const price = meta.regularMarketPrice ?? candles.at(-1)?.close ?? null;
  const prev = meta.previousClose;
  const dayChangePct =
    price != null && prev != null && prev !== 0
      ? ((price - prev) / prev) * 100
      : (meta.regularMarketChangePercent ?? null);
  const marketTime = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : candles.at(-1)
      ? new Date(candles.at(-1)!.time * 1000).toISOString()
      : null;
  await sleep(120);
  return {
    symbol,
    price,
    dayChangePct,
    marketTime,
    candles,
    error: candles.length === 0 ? "serie vacía" : null,
  };
}

function empty(symbol: string, error: string): QuoteSeries {
  return {
    symbol,
    price: null,
    dayChangePct: null,
    marketTime: null,
    candles: [],
    error,
  };
}
