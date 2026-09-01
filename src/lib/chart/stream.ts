import type { Candle } from "@/lib/trading/types";

export function unwrapBinancePayload(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in raw && "stream" in raw) {
    const o = raw as { stream?: unknown; data?: unknown };
    if (typeof o.stream === "string" && o.data != null) return o.data;
  }
  return raw;
}

export function parseBinanceKline(
  raw: unknown,
): { candle: Candle; eventTs: number; closed: boolean } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as {
    E?: number;
    k?: { t: number; o: string; h: string; l: string; c: string; v: string; x?: boolean };
  };
  const k = o.k;
  if (!k) return null;
  const candle: Candle = {
    time: Math.floor(Number(k.t) / 1000),
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
  };
  if (![candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
    return null;
  }
  const eventTs = Number.isFinite(Number(o.E)) ? Math.floor(Number(o.E) / 1000) : candle.time;
  return { candle, eventTs, closed: k.x === true };
}

export function parseBinanceAggTrade(raw: unknown): { price: number; ts: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { p?: string; T?: number };
  const price = Number(o.p);
  const ts = Math.floor(Number(o.T) / 1000);
  if (!(price > 0) || !Number.isFinite(ts)) return null;
  return { price, ts };
}
