/**
 * Isolated chart candle loader. Read-only vs the V1 engine:
 * does not compute signals, quality, risk or setups.
 */
import type { AssetId, Candle } from "@/lib/trading/types";
import { getAsset } from "@/lib/trading/assets";
import { isCmeSessionOpen } from "@/lib/trading/integrity";
import type { ChartSeries, ChartTf } from "@/lib/chart/types";
import { CHART_HISTORY_LIMIT } from "@/lib/chart/view";
import { fetchJson } from "./http";
import { finiteCandle, lastBarIso } from "./series";

const BINANCE: Record<ChartTf, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
  "1M": "1M",
};

const BITGET: Record<ChartTf, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
};

const OKX: Record<ChartTf, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
};

const MEXC: Record<ChartTf, string> = {
  "1m": "Min1",
  "5m": "Min5",
  "15m": "Min15",
  "30m": "Min30",
  "1h": "Min60",
  "4h": "Hour4",
  "1d": "Day1",
  "1w": "Week1",
  "1M": "Month1",
};

const KRAKEN: Partial<Record<ChartTf, number>> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
  "1w": 10080,
};

const BINANCE_HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.us",
  "https://api.binance.com",
];

type Pack = { candles: Candle[]; source: string; error: string | null };

function sortDedupe(raw: Candle[]): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of raw) {
    if (finiteCandle(c)) map.set(c.time, c);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function volumeOk(candles: Candle[]): boolean {
  let n = 0;
  for (const c of candles) {
    if (c.volume != null && Number.isFinite(c.volume) && c.volume > 0) n += 1;
  }
  return n >= Math.min(10, candles.length);
}

function parseBinanceRows(data: unknown[][]): Candle[] {
  return sortDedupe(
    data.map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    })),
  );
}

async function fromBinance(symbol: string, tf: ChartTf, limit = CHART_HISTORY_LIMIT): Promise<Pack> {
  const source = `Binance ${symbol}`;
  let last = "sin respuesta";
  for (const host of BINANCE_HOSTS) {
    const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${BINANCE[tf]}&limit=${limit}`;
    const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 0 });
    if (!res.ok || !Array.isArray(res.data)) {
      last = res.error || `HTTP ${res.status}`;
      continue;
    }
    const candles = parseBinanceRows(res.data as unknown[][]);
    return { candles, source, error: candles.length ? null : "serie vacía" };
  }
  return { candles: [], source, error: last };
}

async function fromBitget(symbol: string, tf: ChartTf, limit = CHART_HISTORY_LIMIT): Promise<Pack> {
  const source = `Bitget ${symbol}`;
  const url = `https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}&granularity=${BITGET[tf]}&limit=${limit}`;
  const res = await fetchJson<{ msg?: string; data?: string[][] }>(url, {
    timeoutMs: 12000,
    retries: 1,
  });
  if (!res.ok || !res.data?.data || !Array.isArray(res.data.data)) {
    return { candles: [], source, error: res.data?.msg || res.error || `HTTP ${res.status}` };
  }
  const candles = sortDedupe(
    res.data.data.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    })),
  );
  return { candles, source, error: candles.length ? null : "serie vacía" };
}

async function fromOkx(instId: string, tf: ChartTf, limit = 300): Promise<Pack> {
  const source = `OKX ${instId}`;
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${OKX[tf]}&limit=${limit}`;
  const res = await fetchJson<{ msg?: string; data?: string[][] }>(url, {
    timeoutMs: 12000,
    retries: 1,
  });
  if (!res.ok || !res.data?.data || !Array.isArray(res.data.data)) {
    return { candles: [], source, error: res.data?.msg || res.error || `HTTP ${res.status}` };
  }
  const candles = sortDedupe(
    res.data.data.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    })),
  );
  return { candles, source, error: candles.length ? null : "serie vacía" };
}

async function fromMexc(contract: string, tf: ChartTf): Promise<Pack> {
  const source = `MEXC ${contract}`;
  const url = `https://contract.mexc.com/api/v1/contract/kline/${encodeURIComponent(contract)}?interval=${MEXC[tf]}`;
  const res = await fetchJson<{
    success?: boolean;
    data?: {
      time?: number[];
      open?: number[];
      high?: number[];
      low?: number[];
      close?: number[];
      vol?: number[];
    };
  }>(url, { timeoutMs: 12000, retries: 1 });
  const d = res.data?.data;
  if (!res.ok || !d?.time || !d.open) {
    return { candles: [], source, error: res.error || "serie no disponible" };
  }
  const candles = sortDedupe(
    d.time.map((t, i) => ({
      time: t > 1e12 ? Math.floor(t / 1000) : t,
      open: Number(d.open?.[i]),
      high: Number(d.high?.[i]),
      low: Number(d.low?.[i]),
      close: Number(d.close?.[i]),
      volume: Number(d.vol?.[i]),
    })),
  );
  return { candles, source, error: candles.length ? null : "serie vacía" };
}

async function fromKraken(pair: string, tf: ChartTf): Promise<Pack> {
  const source = `Kraken ${pair}`;
  const interval = KRAKEN[tf];
  if (interval == null) {
    return { candles: [], source, error: `${tf} no disponible en Kraken` };
  }
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`;
  const res = await fetchJson<{ error?: string[]; result?: Record<string, unknown> }>(
    url,
    { timeoutMs: 12000, retries: 1 },
  );
  const result = res.data?.result;
  const key = result ? Object.keys(result).find((k) => k !== "last") : null;
  const rows = key && Array.isArray(result?.[key]) ? (result[key] as unknown[][]) : null;
  if (!res.ok || !rows) {
    return {
      candles: [],
      source,
      error: res.data?.error?.join(", ") || res.error || "serie no disponible",
    };
  }
  const candles = sortDedupe(
    rows.map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[6]),
    })),
  );
  return { candles, source, error: candles.length ? null : "serie vacía" };
}

function sessionIsOpen(assetId: AssetId, now: number): boolean {
  const asset = getAsset(assetId);
  return asset.session === "crypto24" || asset.session === "spot"
    ? true
    : isCmeSessionOpen(now);
}

async function loadRaw(assetId: AssetId, tf: ChartTf): Promise<Pack> {
  const asset = getAsset(assetId);
  const attempts: Array<() => Promise<Pack>> = [];
  if (asset.binanceSymbol) attempts.push(() => fromBinance(asset.binanceSymbol!, tf));
  if (asset.bitgetSymbol) attempts.push(() => fromBitget(asset.bitgetSymbol!, tf));
  if (asset.okxInstId) attempts.push(() => fromOkx(asset.okxInstId!, tf));
  if (asset.mexcContract) attempts.push(() => fromMexc(asset.mexcContract!, tf));
  if (asset.krakenPair) attempts.push(() => fromKraken(asset.krakenPair!, tf));

  const errors: string[] = [];
  for (const run of attempts) {
    try {
      const pack = await run();
      if (pack.candles.length >= 20) return pack;
      if (pack.error) errors.push(`${pack.source}: ${pack.error}`);
      else errors.push(`${pack.source}: solo ${pack.candles.length} velas`);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "error");
    }
  }
  return {
    candles: [],
    source: asset.venue,
    error: errors.length
      ? `DATOS NO DISPONIBLES — ${errors.join(" · ")}`
      : "DATOS NO DISPONIBLES",
  };
}

export async function loadChartSeries(assetId: AssetId, tf: ChartTf): Promise<ChartSeries> {
  const asset = getAsset(assetId);
  const pack = await loadRaw(assetId, tf);
  const now = Date.now();
  const sessionOpen = sessionIsOpen(assetId, now);

  let proxyNote: string | null = null;
  if (asset.instrumentKind === "proxy") {
    if (asset.id === "XAUUSD") {
      proxyNote = "Velas PROXY XAUUSDT. No es el spot XAUUSD ni un futuro COMEX. No es last T4Trade.";
    } else if (asset.id === "WTI") {
      proxyNote = "ANÁLISIS · CLUSDT · BITGET · PROXY. No es T4Trade WTICash.";
    } else if (asset.id === "US100") {
      proxyNote = "ANÁLISIS · NDX100USDT · BITGET · PROXY. No es T4Trade US100Cash.";
    } else {
      proxyNote = `ANÁLISIS · PROXY ${asset.feedSymbol}. No es T4Trade ${asset.label}.`;
    }
  }

  const sessionLabel = sessionOpen ? "Sesión abierta" : "Mercado cerrado";

  let streamKind: ChartSeries["streamKind"] = null;
  let streamSymbol: string | null = null;
  if (sessionOpen && pack.candles.length) {
    if (pack.source.startsWith("Binance") && asset.binanceSymbol) {
      streamKind = "binance";
      streamSymbol = asset.binanceSymbol;
    } else if (pack.source.startsWith("Bitget") && asset.bitgetSymbol) {
      streamKind = "bitget";
      streamSymbol = asset.bitgetSymbol;
    }
  }

  return {
    assetId,
    tf,
    candles: pack.candles,
    source: pack.source,
    feedSymbol: asset.feedSymbol,
    venue: asset.venue,
    instrumentKind: asset.instrumentKind,
    proxyNote,
    sessionOpen,
    sessionLabel,
    lastBarAt: lastBarIso(pack.candles),
    volumeAvailable: volumeOk(pack.candles),
    error: pack.candles.length ? null : pack.error,
    digits: asset.digits,
    streamKind,
    streamSymbol,
  };
}

/** Paginación futura: velas reales anteriores a `endTimeSec`. No inventa huecos. */
export async function loadChartBefore(
  assetId: AssetId,
  tf: ChartTf,
  endTimeSec: number,
): Promise<Candle[]> {
  const asset = getAsset(assetId);
  if (!asset.binanceSymbol || !Number.isFinite(endTimeSec) || endTimeSec <= 0) return [];
  const endTime = Math.floor(endTimeSec * 1000);
  const symbol = asset.binanceSymbol;
  for (const host of BINANCE_HOSTS) {
    const url = `${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${BINANCE[tf]}&limit=${CHART_HISTORY_LIMIT}&endTime=${endTime}`;
    const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 0 });
    if (!res.ok || !Array.isArray(res.data)) continue;
    return parseBinanceRows(res.data as unknown[][]).filter((c) => c.time < endTimeSec);
  }
  return [];
}

export async function loadChartLast(
  assetId: AssetId,
  tf: ChartTf,
): Promise<{ candle: Candle | null; sessionOpen: boolean }> {
  const asset = getAsset(assetId);
  const sessionOpen = sessionIsOpen(assetId, Date.now());
  if (!sessionOpen) return { candle: null, sessionOpen: false };

  const attempts: Array<() => Promise<Pack>> = [];
  if (asset.binanceSymbol) attempts.push(() => fromBinance(asset.binanceSymbol!, tf, 5));
  if (asset.bitgetSymbol) attempts.push(() => fromBitget(asset.bitgetSymbol!, tf, 5));
  if (asset.okxInstId) attempts.push(() => fromOkx(asset.okxInstId!, tf, 5));

  for (const run of attempts) {
    try {
      const pack = await run();
      const candle = pack.candles.at(-1) ?? null;
      if (candle) return { candle, sessionOpen: true };
    } catch {
      /* next source */
    }
  }
  return { candle: null, sessionOpen: true };
}
