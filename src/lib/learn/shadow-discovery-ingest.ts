import type { AssetId } from "../trading/types";
import { fetchJson } from "../market/http";
import { excludeOpenBars, sanitizeBars } from "./shadow-discovery-bars";
import {
  DISCOVERY_ARCHIVE_TFS,
  DISCOVERY_STEP_SEC,
  type DiscoveryBar,
  type DiscoveryInstrumentKind,
  type DiscoveryTf,
} from "./shadow-discovery-types";

interface RawCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

export interface DiscoveryInstrument {
  venue: "Binance" | "OKX" | "Bitget";
  symbol: string;
  kind: DiscoveryInstrumentKind;
  fallbackVenue?: "OKX" | "Bitget";
  fallbackSymbol?: string;
}

/** Exact native instruments. All are proxies, never the cash/future pit. */
export const DISCOVERY_INSTRUMENTS: Record<AssetId, DiscoveryInstrument> = {
  BTCUSD: { venue: "Binance", symbol: "BTCUSDT", kind: "proxy-usdt-kline", fallbackVenue: "OKX", fallbackSymbol: "BTC-USDT" },
  XAUUSD: { venue: "OKX", symbol: "XAU-USDT-SWAP", kind: "proxy-swap", fallbackVenue: "Bitget", fallbackSymbol: "XAUUSDT" },
  US100: { venue: "Bitget", symbol: "NDX100USDT", kind: "proxy-swap" },
  WTI: { venue: "Bitget", symbol: "CLUSDT", kind: "proxy-swap", fallbackVenue: "OKX", fallbackSymbol: "CL-USDT-SWAP" },
};

/** Storage budget only — not a claim that the API has this many years. */
export const DISCOVERY_STORAGE_LOOKBACK_SEC: Record<DiscoveryTf, number> = {
  "1m": 8 * 86400,
  "5m": 21 * 86400,
  "15m": 2 * 365 * 86400,
  "30m": 2 * 365 * 86400,
  "1h": 3 * 365 * 86400,
  "4h": 5 * 365 * 86400,
};

export const DISCOVERY_PAGES_PER_CALL = 8;

const OKX_BAR: Record<DiscoveryTf, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H",
};
const BITGET_BAR: Record<DiscoveryTf, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1H", "4h": "4H",
};
const BINANCE_BAR: Record<DiscoveryTf, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h",
};

function pageLimit(venue: DiscoveryInstrument["venue"]): number {
  if (venue === "Binance") return 1000;
  if (venue === "OKX") return 300;
  return 200;
}

function toBar(
  assetId: AssetId,
  tf: DiscoveryTf,
  source: string,
  instrument: string,
  kind: DiscoveryInstrumentKind,
  r: RawCandle,
): DiscoveryBar | null {
  const b: DiscoveryBar = {
    assetId, tf, t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
    source, instrument, instrumentKind: kind,
  };
  return Number.isFinite(b.t) && b.t > 0 ? b : null;
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

export interface NativePage {
  candles: RawCandle[];
  source: string;
  instrument: string;
  kind: DiscoveryInstrumentKind;
}

export type NativePageFetcher = (args: {
  venue: DiscoveryInstrument["venue"];
  symbol: string;
  tf: DiscoveryTf;
  limit: number;
  beforeOpenSec: number | null;
}) => Promise<NativePage>;

async function defaultFetchPage(args: {
  venue: DiscoveryInstrument["venue"];
  symbol: string;
  tf: DiscoveryTf;
  limit: number;
  beforeOpenSec: number | null;
}): Promise<NativePage> {
  const { venue, symbol, tf, limit, beforeOpenSec } = args;
  if (venue === "Binance") {
    let url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${BINANCE_BAR[tf]}&limit=${limit}`;
    if (beforeOpenSec != null) url += `&endTime=${beforeOpenSec * 1000 - 1}`;
    const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 1 });
    return {
      candles: res.ok ? parseBinance(res.data) : [],
      source: `Binance ${symbol}`,
      instrument: symbol,
      kind: "proxy-usdt-kline",
    };
  }
  if (venue === "OKX") {
    const path = beforeOpenSec != null ? "history-candles" : "candles";
    let url = `https://www.okx.com/api/v5/market/${path}?instId=${encodeURIComponent(symbol)}&bar=${OKX_BAR[tf]}&limit=${limit}`;
    if (beforeOpenSec != null) url += `&after=${beforeOpenSec * 1000}`;
    const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 1 });
    return {
      candles: res.ok ? parseOkx(res.data) : [],
      source: `OKX ${symbol}`,
      instrument: symbol,
      kind: "proxy-swap",
    };
  }
  let url = `https://api.bitget.com/api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}&granularity=${BITGET_BAR[tf]}&limit=${limit}`;
  if (beforeOpenSec != null) url += `&endTime=${beforeOpenSec * 1000 - 1}`;
  const res = await fetchJson<unknown>(url, { timeoutMs: 12000, retries: 1 });
  return {
    candles: res.ok ? parseBitget(res.data) : [],
    source: `Bitget ${symbol}`,
    instrument: symbol,
    kind: "proxy-swap",
  };
}

function barsFromPage(
  assetId: AssetId,
  tf: DiscoveryTf,
  page: NativePage,
  nowSec: number,
): DiscoveryBar[] {
  const raw: DiscoveryBar[] = [];
  for (const c of page.candles) {
    const b = toBar(assetId, tf, page.source, page.instrument, page.kind, c);
    if (b) raw.push(b);
  }
  return sanitizeBars(excludeOpenBars(raw, nowSec), nowSec);
}

export interface BackfillResult {
  bars: DiscoveryBar[];
  exhausted: boolean;
  pages: number;
  source: string;
  instrument: string;
  kind: DiscoveryInstrumentKind;
  oldestT: number | null;
  newestT: number | null;
}

/**
 * Walk a native series backwards from `beforeOpenSec` (exclusive).
 * Stops when the provider returns a short page, nothing new, or storage lookback.
 * Never builds one TF out of another.
 */
export async function paginateNativeSeries(args: {
  assetId: AssetId;
  tf: DiscoveryTf;
  beforeOpenSec: number | null;
  nowSec: number;
  pages?: number;
  pageSize?: number;
  fetchPage?: NativePageFetcher;
}): Promise<BackfillResult> {
  const spec = DISCOVERY_INSTRUMENTS[args.assetId];
  const tf = args.tf;
  const nowSec = args.nowSec;
  const maxPages = args.pages ?? DISCOVERY_PAGES_PER_CALL;
  const fetchPage = args.fetchPage ?? defaultFetchPage;
  const floor = nowSec - DISCOVERY_STORAGE_LOOKBACK_SEC[tf];
  let before = args.beforeOpenSec;
  let venue = spec.venue;
  let symbol = spec.symbol;
  const all: DiscoveryBar[] = [];
  let source = `${spec.venue} ${spec.symbol}`;
  let instrument = spec.symbol;
  let kind = spec.kind;
  let exhausted = false;
  let pages = 0;

  for (let p = 0; p < maxPages; p++) {
    const limit = args.pageSize ?? pageLimit(venue);
    let page = await fetchPage({ venue, symbol, tf, limit, beforeOpenSec: before });
    if (!page.candles.length && spec.fallbackVenue && spec.fallbackSymbol && p === 0 && before == null) {
      venue = spec.fallbackVenue;
      symbol = spec.fallbackSymbol;
      page = await fetchPage({ venue, symbol, tf, limit: pageLimit(venue), beforeOpenSec: before });
    }
    const mapped = barsFromPage(args.assetId, tf, page, nowSec).filter((b) => b.t >= floor);
    const fresh = mapped.filter((b) => !all.some((x) => x.t === b.t));
    pages += 1;
    if (page.source) source = page.source;
    if (page.instrument) instrument = page.instrument;
    if (page.kind) kind = page.kind;
    if (!fresh.length) {
      exhausted = true;
      break;
    }
    all.push(...fresh);
    const oldestKnown = Math.min(...fresh.map((b) => b.t));
    before = oldestKnown;
    if (mapped.length < limit || oldestKnown <= floor) {
      exhausted = true;
      break;
    }
  }

  const bars = sanitizeBars(all, nowSec);
  return {
    bars,
    exhausted,
    pages,
    source,
    instrument,
    kind,
    oldestT: bars.length ? bars[0]!.t : null,
    newestT: bars.length ? bars[bars.length - 1]!.t : null,
  };
}

/** One-shot helper used by tests and the first-page path. */
export async function ingestNativeDiscovery(args: {
  assets?: readonly AssetId[];
  tfs?: readonly DiscoveryTf[];
  limit?: number;
  nowSec?: number;
  pages?: number;
  fetchPage?: NativePageFetcher;
}): Promise<DiscoveryBar[]> {
  const assets = args.assets ?? (["XAUUSD", "BTCUSD", "US100", "WTI"] as const);
  const tfs = args.tfs ?? DISCOVERY_ARCHIVE_TFS;
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  const jobs = assets.flatMap((assetId) => tfs.map((tf) => paginateNativeSeries({
    assetId, tf, beforeOpenSec: null, nowSec, pages: args.pages ?? 1, fetchPage: args.fetchPage,
  })));
  const parts = await Promise.all(jobs);
  return sanitizeBars(parts.flatMap((p) => p.bars), nowSec);
}

export function assertNativeTf(tf: DiscoveryTf): void {
  if (!DISCOVERY_STEP_SEC[tf]) throw new Error(`timeframe no nativo: ${tf}`);
}
