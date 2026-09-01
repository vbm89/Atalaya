import type { Candle } from "@/lib/trading/types";
import { fetchJson } from "./http";

const INTERVAL: Record<"5m" | "15m" | "1h" | "4h", number> = {
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
};

interface KrakenOHLC {
  error?: string[];
  result?: Record<string, unknown>;
}

export async function fetchKrakenOHLC(
  pair: string,
  tf: "5m" | "15m" | "1h" | "4h",
): Promise<{ candles: Candle[]; error: string | null }> {
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${INTERVAL[tf]}`;
  const res = await fetchJson<KrakenOHLC>(url, { timeoutMs: 12000, retries: 1 });
  if (!res.ok || !res.data?.result) {
    return { candles: [], error: res.error ?? `HTTP ${res.status}` };
  }
  const result = res.data.result;
  const key = Object.keys(result).find((k) => k !== "last");
  const rows = key ? (result[key] as unknown) : null;
  if (!Array.isArray(rows)) return { candles: [], error: "serie inválida" };
  const candles: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    candles.push({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[6] ?? row[5]),
    });
  }
  return { candles, error: candles.length ? null : "serie vacía" };
}

export async function fetchKrakenTicker(
  pair: string,
): Promise<{ price: number | null; changePct: number | null; error: string | null }> {
  const url = `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`;
  const res = await fetchJson<{
    error?: string[];
    result?: Record<string, { c?: string[]; o?: string }>;
  }>(url, { timeoutMs: 8000, retries: 1 });
  const result = res.data?.result;
  const key = result ? Object.keys(result)[0] : null;
  const row = key ? result![key] : null;
  const price = row?.c?.[0] ? Number(row.c[0]) : null;
  const open = row?.o ? Number(row.o) : null;
  if (price == null) return { price: null, changePct: null, error: res.error ?? "ticker" };
  const changePct = open && open !== 0 ? ((price - open) / open) * 100 : null;
  return { price, changePct, error: null };
}
