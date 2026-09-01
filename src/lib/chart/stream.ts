import type { Candle } from "../trading/types";

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

export function parseBinanceMiniTicker(raw: unknown): { symbol: string; price: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { e?: string; s?: string; c?: string };
  if (o.e && o.e !== "24hrMiniTicker") return null;
  const symbol = typeof o.s === "string" ? o.s : "";
  const price = Number(o.c);
  if (!symbol || !(price > 0)) return null;
  return { symbol, price };
}

function positive(n: unknown): number | null {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : null;
}

/** US100/NDX lastPr is often a stale last trade. Other Bitget tickers keep lastPr. */
export function bitgetLivePrice(
  row: { lastPr?: string; last?: string; markPrice?: string; bidPr?: string; askPr?: string; indexPrice?: string },
  instId: string,
): number | null {
  if (instId === "NDX100USDT") {
    const mark = positive(row.markPrice);
    if (mark != null) return mark;
    const bid = positive(row.bidPr);
    const ask = positive(row.askPr);
    if (bid != null && ask != null) return (bid + ask) / 2;
    const index = positive(row.indexPrice);
    if (index != null) return index;
  }
  return positive(row.lastPr ?? row.last);
}

export function parseBitgetTicker(raw: unknown): { instId: string; price: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { arg?: { channel?: string; instId?: string }; data?: unknown };
  const rows = Array.isArray(o.data) ? o.data : [];
  const last = rows.at(-1);
  if (!last || typeof last !== "object") return null;
  const row = last as {
    instId?: string;
    lastPr?: string;
    last?: string;
    markPrice?: string;
    bidPr?: string;
    askPr?: string;
    indexPrice?: string;
  };
  const instId = row.instId || o.arg?.instId || "";
  const price = bitgetLivePrice(row, instId);
  if (!instId || price == null) return null;
  return { instId, price };
}
