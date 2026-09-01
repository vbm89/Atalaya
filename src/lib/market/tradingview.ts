import type { AssetId } from "@/lib/trading/types";
import { fetchJson } from "./http";

export interface TvSnapshot {
  symbol: string;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  dayChangePct: number | null;
  volume: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  atr: number | null;
  support1: number | null;
  support2: number | null;
  resist1: number | null;
  resist2: number | null;
  monthHigh: number | null;
  monthLow: number | null;
}

const TV_SYMBOL: Record<AssetId, string> = {
  XAUUSD: "COMEX:GC1!",
  BTCUSD: "BITSTAMP:BTCUSD",
  US100: "CME_MINI:NQ1!",
  WTI: "NYMEX:CL1!",
};

const FIELDS = [
  "close",
  "open",
  "high",
  "low",
  "change",
  "volume",
  "EMA20",
  "EMA50",
  "EMA200",
  "RSI",
  "MACD.macd",
  "MACD.signal",
  "ATR",
  "Pivot.M.Classic.S1",
  "Pivot.M.Classic.S2",
  "Pivot.M.Classic.R1",
  "Pivot.M.Classic.R2",
  "High.1M",
  "Low.1M",
].join(",");

export async function fetchTvSnapshot(id: AssetId): Promise<{
  snapshot: TvSnapshot | null;
  error: string | null;
}> {
  const symbol = TV_SYMBOL[id];
  const url = `https://scanner.tradingview.com/symbol?symbol=${encodeURIComponent(symbol)}&fields=${encodeURIComponent(FIELDS)}`;
  const res = await fetchJson<Record<string, number | null>>(url, {
    timeoutMs: 10000,
    retries: 1,
  });
  if (!res.ok || !res.data || typeof res.data.close !== "number") {
    return { snapshot: null, error: res.error ?? `HTTP ${res.status}` };
  }
  const d = res.data;
  return {
    snapshot: {
      symbol,
      price: num(d.close),
      open: num(d.open),
      high: num(d.high),
      low: num(d.low),
      dayChangePct: num(d.change),
      volume: num(d.volume),
      ema20: num(d.EMA20),
      ema50: num(d.EMA50),
      ema200: num(d.EMA200),
      rsi: num(d.RSI),
      macd: num(d["MACD.macd"]),
      macdSignal: num(d["MACD.signal"]),
      atr: num(d.ATR),
      support1: num(d["Pivot.M.Classic.S1"]),
      support2: num(d["Pivot.M.Classic.S2"]),
      resist1: num(d["Pivot.M.Classic.R1"]),
      resist2: num(d["Pivot.M.Classic.R2"]),
      monthHigh: num(d["High.1M"]),
      monthLow: num(d["Low.1M"]),
    },
    error: null,
  };
}

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
