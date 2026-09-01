import type { Candle } from "@/lib/trading/types";
import { fetchJson } from "./http";

type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  ...unknown[],
];

const INTERVAL: Record<"5m" | "15m" | "1h" | "4h", string> = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
};

const HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.us",
  "https://api.binance.com",
];

export async function fetchBinanceKlines(
  symbol: string,
  tf: "5m" | "15m" | "1h" | "4h",
  limit = 400,
): Promise<{ candles: Candle[]; error: string | null; source: string | null }> {
  let lastError: string | null = "sin respuesta";
  for (const host of HOSTS) {
    const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${INTERVAL[tf]}&limit=${limit}`;
    const res = await fetchJson<Kline[] | { msg?: string; code?: number }>(url, {
      timeoutMs: 12000,
      retries: 0,
    });
    if (!res.ok || !res.data || !Array.isArray(res.data)) {
      lastError =
        (res.data && !Array.isArray(res.data) && res.data.msg) ||
        res.error ||
        `HTTP ${res.status}`;
      continue;
    }
    const candles: Candle[] = res.data.map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
    return {
      candles,
      error: candles.length ? null : "serie vacía",
      source: host,
    };
  }
  return { candles: [], error: lastError, source: null };
}

export async function fetchBinanceTicker(
  symbol: string,
): Promise<{ price: number | null; changePct: number | null; error: string | null }> {
  for (const host of HOSTS) {
    const url = `${host}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetchJson<{ lastPrice?: string; priceChangePercent?: string; msg?: string }>(
      url,
      { timeoutMs: 8000, retries: 0 },
    );
    if (res.ok && res.data?.lastPrice) {
      return {
        price: Number(res.data.lastPrice),
        changePct: res.data.priceChangePercent
          ? Number(res.data.priceChangePercent)
          : null,
        error: null,
      };
    }
  }
  return { price: null, changePct: null, error: "ticker no disponible" };
}
