import type { AssetId } from "../trading/types";
import { fetchJson } from "../market/http";
import { DISCOVERY_ARCHIVE_TFS, DISCOVERY_STEP_SEC, type DiscoveryBar, type DiscoveryTf } from "./shadow-discovery-types";
import { ohlcValid } from "./shadow-discovery-bars";

interface RawCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

const OKX_BAR: Record<DiscoveryTf, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H",
};
const BITGET_BAR: Record<DiscoveryTf, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H",
};
const BINANCE_BAR: Record<DiscoveryTf, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h",
};

function toBar(assetId: AssetId, tf: DiscoveryTf, source: string, r: RawCandle): DiscoveryBar | null {
  const b: DiscoveryBar = { assetId, tf, t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, source };
  return ohlcValid(b) && b.t > 0 ? b : null;
}

function parseOkx(data: unknown): RawCandle[] {
  const rows = (data as { data?: string[][] })?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    t: Math.floor(Number(row[0]) / 1000),
    o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]),
    v: row[5] == null ? null : Number(row[5]),
  }));
}

function parseBitget(data: unknown): RawCandle[] {
  const rows = (data as { data?: string[][] })?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    t: Math.floor(Number(row[0]) / 1000),
    o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]),
    v: row[5] == null ? null : Number(row[5]),
  }));
}

function parseBinance(data: unknown): RawCandle[] {
  if (!Array.isArray(data)) return [];
  return (data as unknown[][]).map((row) => ({
    t: Math.floor(Number(row[0]) / 1000),
    o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]),
    v: row[5] == null ? null : Number(row[5]),
  }));
}

async function fetchOkx(instId: string, tf: DiscoveryTf, limit: number): Promise<{ candles: RawCandle[]; source: string }> {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${OKX_BAR[tf]}&limit=${limit}`;
  const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 1 });
  return { candles: res.ok ? parseOkx(res.data) : [], source: `OKX ${instId}` };
}

async function fetchBitget(symbol: string, tf: DiscoveryTf, limit: number): Promise<{ candles: RawCandle[]; source: string }> {
  const url = `https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}&granularity=${BITGET_BAR[tf]}&limit=${limit}`;
  const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 1 });
  return { candles: res.ok ? parseBitget(res.data) : [], source: `Bitget ${symbol}` };
}

async function fetchBinance(symbol: string, tf: DiscoveryTf, limit: number): Promise<{ candles: RawCandle[]; source: string }> {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${BINANCE_BAR[tf]}&limit=${limit}`;
  const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 1 });
  return { candles: res.ok ? parseBinance(res.data) : [], source: `Binance ${symbol}` };
}

async function nativeSeries(assetId: AssetId, tf: DiscoveryTf, limit: number): Promise<DiscoveryBar[]> {
  let pack: { candles: RawCandle[]; source: string } = { candles: [], source: "none" };
  if (assetId === "BTCUSD") {
    pack = await fetchBinance("BTCUSDT", tf, limit);
    if (!pack.candles.length) pack = await fetchOkx("BTC-USDT", tf, limit);
  } else if (assetId === "XAUUSD") {
    pack = await fetchOkx("XAU-USDT-SWAP", tf, limit);
    if (!pack.candles.length) pack = await fetchBitget("XAUUSDT", tf, limit);
  } else if (assetId === "US100") {
    pack = await fetchBitget("NDX100USDT", tf, limit);
  } else {
    pack = await fetchBitget("CLUSDT", tf, limit);
    if (!pack.candles.length) pack = await fetchOkx("CL-USDT-SWAP", tf, limit);
  }
  const now = Math.floor(Date.now() / 1000);
  const step = DISCOVERY_STEP_SEC[tf];
  const out: DiscoveryBar[] = [];
  for (const c of pack.candles) {
    if (c.t + step > now) continue;
    const b = toBar(assetId, tf, pack.source, c);
    if (b) out.push(b);
  }
  return out;
}

/**
 * Native-only ingest. Never resamples 15m into 30m/5m/1m.
 * `limit` is per request (exchange cap). Caller paginates if needed.
 */
export async function ingestNativeDiscovery(args: {
  assets?: readonly AssetId[];
  tfs?: readonly DiscoveryTf[];
  limit?: number;
}): Promise<DiscoveryBar[]> {
  const assets = args.assets ?? (["XAUUSD", "BTCUSD", "US100", "WTI"] as const);
  const tfs = args.tfs ?? DISCOVERY_ARCHIVE_TFS;
  const limit = args.limit ?? 300;
  const jobs = assets.flatMap((assetId) => tfs.map((tf) => nativeSeries(assetId, tf, limit)));
  const parts = await Promise.all(jobs);
  return parts.flat();

}

export function assertNativeTf(tf: DiscoveryTf): void {
  if (!DISCOVERY_STEP_SEC[tf]) throw new Error(`timeframe no nativo: ${tf}`);
}
