/**
 * Carga de barras: live (Yahoo / Kraken / OKX) o sintético.
 * Nunca inventa OHLC inválido. La vela abierta se descarta.
 * Si Yahoo responde 429 o trae cinta vieja, se prueba OKX y se registra el fallo.
 */
import { STEP_SEC } from "./constants.ts";
import { fixtureById, fixtureReplayTape } from "./fixtures.ts";
import { ohlcValid } from "./primitives.ts";
import type { AssetId, DataSourceKind, EntryTf, ShadowBar } from "./types.ts";
import { fetchYahooChart, getYahooBrokerStats, type YahooFetchMeta } from "./yahoo-broker.ts";

export { getYahooBrokerStats };

const YF: Record<Exclude<AssetId, "BTCUSD">, string> = {
  XAUUSD: "GC=F",
  US100: "NQ=F",
  WTI: "CL=F",
};

const YF_INTERVAL: Record<EntryTf, string> = {
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "4h": "1h",
};

const OKX_INST: Record<AssetId, string> = {
  XAUUSD: "XAU-USDT-SWAP",
  US100: "US100-USDT-SWAP",
  WTI: "CL-USDT-SWAP",
  BTCUSD: "BTC-USDT",
};

const OKX_BAR: Record<EntryTf, string> = {
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
};

/** Si la última vela cerrada es más vieja, la cinta no cuenta como precio vivo. */
export const FRESH_TAPE_LAG_SEC = 25 * 60;

export function tapeIsFresh(bars: readonly { t: number }[] | null, tf: EntryTf, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!bars?.length) return false;
  const last = bars[bars.length - 1]!;
  return nowSec - (last.t + STEP_SEC[tf]) <= FRESH_TAPE_LAG_SEC;
}

function closeOpenBars(bars: ShadowBar[], nowSec = Math.floor(Date.now() / 1000)): ShadowBar[] {
  return bars.filter((b) => b.t + STEP_SEC[b.tf] <= nowSec && ohlcValid(b));
}

export async function fetchJson(url: string, timeoutMs = 8000): Promise<FetchTrace> {
  const ctrl = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) {
      return { endpoint: url, httpStatus: res.status, timeout: false, error: `HTTP ${res.status}`, json: null, retryAfterSec: null, bodySnippet: null };
    }
    try {
      return { endpoint: url, httpStatus: res.status, timeout: false, error: null, json: await res.json(), retryAfterSec: null, bodySnippet: null };
    } catch (error) {
      return {
        endpoint: url,
        httpStatus: res.status,
        timeout: false,
        error: error instanceof Error ? error.message : "invalid_json",
        json: null,
        retryAfterSec: null,
        bodySnippet: null,
      };
    }
  } catch (error) {
    return {
      endpoint: url,
      httpStatus: null,
      timeout: timedOut,
      error: timedOut ? "timeout" : error instanceof Error ? error.message : "fetch_failed",
      json: null,
      retryAfterSec: null,
      bodySnippet: null,
    };
  } finally {
    clearTimeout(t);
  }
}

function yfRange(tf: EntryTf): string {
  if (tf === "4h" || tf === "1h") return "3mo";
  return "10d";
}

export type TapeFailureCause = "TIMEOUT" | "HTTP_ERROR" | "NETWORK" | "NO_RESULT" | "SHORT_TAPE";

export interface TapeDiagnostic {
  provider: "yahoo" | "kraken" | "okx";
  endpoint: string;
  httpStatus: number | null;
  timeout: boolean;
  error: string | null;
  at: number;
  cause: TapeFailureCause;
  barsReceived: number | null;
  barsAfterNormalize: number | null;
  retryAfterSec: number | null;
  bodySnippet: string | null;
  cacheHit: boolean;
  singleFlightHit: boolean;
  cooldownActive: boolean;
  external: boolean;
  requestSource: string | null;
}

export interface FetchTrace {
  endpoint: string;
  httpStatus: number | null;
  timeout: boolean;
  error: string | null;
  json: unknown | null;
  retryAfterSec: number | null;
  bodySnippet: string | null;
}

export interface ProviderAttempt {
  provider: string;
  endpoint: string;
  httpStatus: number | null;
  error: string | null;
  bars: number;
  lastBarT: number | null;
  at: number;
  ok: boolean;
  fresh: boolean;
}

interface LoadedAttempt {
  bars: ShadowBar[] | null;
  diagnostic: TapeDiagnostic | null;
  yahooFetch: YahooFetchMeta | null;
}

export function tapeFailureCause(input: {
  httpStatus: number | null;
  timeout: boolean;
  error: string | null;
  hasResult: boolean;
  barsAfterNormalize: number | null;
}): TapeFailureCause | null {
  if (input.hasResult && input.barsAfterNormalize != null && input.barsAfterNormalize >= 20) return null;
  if (input.timeout) return "TIMEOUT";
  if (input.httpStatus != null && input.httpStatus !== 200) return "HTTP_ERROR";
  if (input.httpStatus == null && input.error) return "NETWORK";
  if (!input.hasResult) return "NO_RESULT";
  return "SHORT_TAPE";
}

function failureDiagnostic(
  provider: TapeDiagnostic["provider"],
  trace: FetchTrace,
  cause: TapeFailureCause,
  counts: { barsReceived: number | null; barsAfterNormalize: number | null },
  access: {
    cacheHit?: boolean;
    singleFlightHit?: boolean;
    cooldownActive?: boolean;
    external?: boolean;
    requestSource?: string | null;
  } = {},
): TapeDiagnostic {
  return {
    provider,
    endpoint: trace.endpoint,
    httpStatus: trace.httpStatus,
    timeout: trace.timeout,
    error: trace.error,
    at: Date.now(),
    cause,
    barsReceived: counts.barsReceived,
    barsAfterNormalize: counts.barsAfterNormalize,
    retryAfterSec: trace.retryAfterSec,
    bodySnippet: trace.bodySnippet,
    cacheHit: access.cacheHit === true,
    singleFlightHit: access.singleFlightHit === true,
    cooldownActive: access.cooldownActive === true,
    external: access.external !== false,
    requestSource: access.requestSource ?? null,
  };
}

function usable(attempt: LoadedAttempt): attempt is LoadedAttempt & { bars: ShadowBar[] } {
  return !!attempt.bars && attempt.bars.length >= 20 && attempt.diagnostic == null;
}

function describeAttempt(provider: string, attempt: LoadedAttempt, tf: EntryTf, nowSec: number): ProviderAttempt {
  const bars = attempt.bars ?? [];
  const last = bars.length ? bars[bars.length - 1]! : null;
  const fresh = tapeIsFresh(bars, tf, nowSec);
  return {
    provider: attempt.diagnostic?.provider ?? provider,
    endpoint: attempt.diagnostic?.endpoint ?? bars[0]?.source ?? provider,
    httpStatus: attempt.diagnostic?.httpStatus ?? (bars.length ? 200 : null),
    error: attempt.diagnostic?.error ?? (bars.length && !fresh ? "stale" : null),
    bars: bars.length,
    lastBarT: last?.t ?? null,
    at: attempt.diagnostic?.at ?? Date.now(),
    ok: usable(attempt),
    fresh: usable(attempt) && fresh,
  };
}

async function loadYahoo(asset: AssetId, tf: EntryTf, requestSource: string | null): Promise<LoadedAttempt> {
  if (asset === "BTCUSD") return { bars: null, diagnostic: null, yahooFetch: null };
  const symbol = YF[asset];
  const interval = YF_INTERVAL[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${yfRange(tf)}`;
  const { trace, meta } = await fetchYahooChart(url);
  const access = { ...meta, requestSource };
  const json = trace.json as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] }> } }> };
  } | null;
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp;
  const q = result?.indicators?.quote?.[0];
  if (!ts || !q) {
    const cause =
      tapeFailureCause({
        httpStatus: trace.httpStatus,
        timeout: trace.timeout,
        error: trace.error,
        hasResult: false,
        barsAfterNormalize: null,
      }) ?? "NO_RESULT";
    return {
      bars: null,
      yahooFetch: { ...meta, requestSource },
      diagnostic: failureDiagnostic("yahoo", trace, cause, { barsReceived: ts?.length ?? null, barsAfterNormalize: null }, access),
    };
  }
  const bars: ShadowBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i];
    const h = q.high[i];
    const l = q.low[i];
    const c = q.close[i];
    if (![o, h, l, c].every((n) => n != null && Number.isFinite(n))) continue;
    const t = ts[i]!;
    bars.push({
      assetId: asset,
      tf,
      t,
      o: o!,
      h: h!,
      l: l!,
      c: c!,
      v: q.volume[i] ?? null,
      source: `yahoo:${symbol}`,
    });
  }
  const closed = tf === "4h" ? aggregate(bars, asset, "1h", 4) : closeOpenBars(bars);
  const cause = tapeFailureCause({
    httpStatus: trace.httpStatus,
    timeout: false,
    error: null,
    hasResult: true,
    barsAfterNormalize: closed.length,
  });
  return {
    bars: closed,
    yahooFetch: { ...meta, requestSource },
    diagnostic: cause
      ? failureDiagnostic("yahoo", trace, cause, { barsReceived: ts.length, barsAfterNormalize: closed.length }, access)
      : null,
  };
}

function aggregate(bars: ShadowBar[], asset: AssetId, from: EntryTf, n: number): ShadowBar[] {
  if (from !== "1h" || n !== 4) return bars;
  const step = STEP_SEC["4h"];
  const out: ShadowBar[] = [];
  const byBucket = new Map<number, ShadowBar[]>();
  for (const b of bars) {
    const bucket = Math.floor(b.t / step) * step;
    const list = byBucket.get(bucket) ?? [];
    list.push(b);
    byBucket.set(bucket, list);
  }
  const keys = [...byBucket.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    const g = byBucket.get(k)!;
    if (g.length < 1) continue;
    out.push({
      assetId: asset,
      tf: "4h",
      t: k,
      o: g[0]!.o,
      h: Math.max(...g.map((x) => x.h)),
      l: Math.min(...g.map((x) => x.l)),
      c: g[g.length - 1]!.c,
      v: g.reduce((s, x) => s + (x.v ?? 0), 0),
      source: g[0]!.source,
    });
  }
  return closeOpenBars(out);
}

async function loadKrakenBtc(tf: EntryTf): Promise<LoadedAttempt> {
  const interval = { "15m": 15, "30m": 30, "1h": 60, "4h": 240 }[tf];
  const url = `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}`;
  const trace = await fetchJson(url);
  const json = trace.json as {
    error?: string[];
    result?: Record<string, Array<[number, string, string, string, string, string, string, number]>>;
  } | null;
  if (!json || json.error?.length) {
    const cause =
      tapeFailureCause({
        httpStatus: trace.httpStatus,
        timeout: trace.timeout,
        error: trace.error ?? (json?.error?.length ? json.error.join(",") : null),
        hasResult: false,
        barsAfterNormalize: null,
      }) ?? "NO_RESULT";
    return {
      bars: null,
      yahooFetch: null,
      diagnostic: failureDiagnostic(
        "kraken",
        { ...trace, error: trace.error ?? (json?.error?.join(",") || null) },
        cause,
        { barsReceived: null, barsAfterNormalize: null },
      ),
    };
  }
  const key = json.result ? Object.keys(json.result).find((k) => k !== "last") : null;
  const rows = key ? json.result![key] : null;
  if (!rows?.length) {
    return {
      bars: null,
      yahooFetch: null,
      diagnostic: failureDiagnostic("kraken", trace, "NO_RESULT", { barsReceived: 0, barsAfterNormalize: null }),
    };
  }
  const bars: ShadowBar[] = rows.map((r) => ({
    assetId: "BTCUSD" as const,
    tf,
    t: r[0],
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
    v: Number(r[6]),
    source: "kraken:XBTUSD",
  }));
  const closed = closeOpenBars(bars);
  const cause = tapeFailureCause({
    httpStatus: trace.httpStatus,
    timeout: false,
    error: null,
    hasResult: true,
    barsAfterNormalize: closed.length,
  });
  return {
    bars: closed,
    yahooFetch: null,
    diagnostic: cause ? failureDiagnostic("kraken", trace, cause, { barsReceived: rows.length, barsAfterNormalize: closed.length }) : null,
  };
}

async function loadOkx(asset: AssetId, tf: EntryTf): Promise<LoadedAttempt> {
  const inst = OKX_INST[asset];
  const bar = OKX_BAR[tf];
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(inst)}&bar=${bar}&limit=300`;
  const trace = await fetchJson(url);
  const json = trace.json as { code?: string; data?: string[][] } | null;
  if (json?.code !== "0" || !json.data?.length) {
    const cause =
      tapeFailureCause({
        httpStatus: trace.httpStatus,
        timeout: trace.timeout,
        error: trace.error ?? (json?.code && json.code !== "0" ? `okx ${json.code}` : null),
        hasResult: false,
        barsAfterNormalize: null,
      }) ?? "NO_RESULT";
    return {
      bars: null,
      yahooFetch: null,
      diagnostic: failureDiagnostic("okx", { ...trace, error: trace.error ?? (json?.code && json.code !== "0" ? `okx ${json.code}` : null) }, cause, {
        barsReceived: json?.data?.length ?? null,
        barsAfterNormalize: null,
      }),
    };
  }
  const bars: ShadowBar[] = json.data
    .map((r) => ({
      assetId: asset,
      tf,
      t: Math.floor(Number(r[0]) / 1000),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      v: Number(r[5]),
      source: `okx:${inst}`,
    }))
    .filter((b) => [b.o, b.h, b.l, b.c, b.t].every((n) => Number.isFinite(n)))
    .sort((a, b) => a.t - b.t);
  const closed = closeOpenBars(bars);
  const cause = tapeFailureCause({
    httpStatus: trace.httpStatus,
    timeout: false,
    error: null,
    hasResult: true,
    barsAfterNormalize: closed.length,
  });
  return {
    bars: closed,
    yahooFetch: null,
    diagnostic: cause ? failureDiagnostic("okx", trace, cause, { barsReceived: json.data.length, barsAfterNormalize: closed.length }) : null,
  };
}

export interface LoadedTape {
  bars: ShadowBar[];
  source: DataSourceKind;
  note: string;
  diagnostic: TapeDiagnostic | null;
  yahooFetch: YahooFetchMeta | null;
  attempts: ProviderAttempt[];
}

function packLive(bars: ShadowBar[], note: string, yahooFetch: YahooFetchMeta | null, attempts: ProviderAttempt[]): LoadedTape {
  return {
    bars,
    source: "LIVE",
    note,
    diagnostic: null,
    yahooFetch,
    attempts,
  };
}

function packFail(note: string, diagnostic: TapeDiagnostic | null, yahooFetch: YahooFetchMeta | null, attempts: ProviderAttempt[]): LoadedTape {
  return {
    bars: [],
    source: "INSUFFICIENT",
    note,
    diagnostic,
    yahooFetch,
    attempts,
  };
}

export async function loadTape(asset: AssetId, tf: EntryTf, scenario = "live", requestSource: string | null = null): Promise<LoadedTape> {
  if (scenario && scenario !== "live") {
    const fx = scenario === "replay" ? fixtureReplayTape() : fixtureById(scenario);
    if (!fx) {
      return { bars: [], source: "INSUFFICIENT", note: `Escenario desconocido: ${scenario}`, diagnostic: null, yahooFetch: null, attempts: [] };
    }
    const bars = fx.bars.map((b) => ({ ...b, assetId: asset, tf }));
    return {
      bars,
      source: "SYNTHETIC",
      note: `Escenario sintético «${fx.label}». No es mercado real. NET UNKNOWN.`,
      diagnostic: null,
      yahooFetch: null,
      attempts: [],
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const attempts: ProviderAttempt[] = [];

  if (asset === "BTCUSD") {
    const kraken = await loadKrakenBtc(tf);
    attempts.push(describeAttempt("kraken", kraken, tf, nowSec));
    if (usable(kraken) && tapeIsFresh(kraken.bars, tf, nowSec)) {
      return packLive(kraken.bars, `Fuente ${kraken.bars[0]?.source ?? "kraken"}. Vela abierta excluida. NET UNKNOWN.`, null, attempts);
    }
    const okx = await loadOkx(asset, tf);
    attempts.push(describeAttempt("okx", okx, tf, nowSec));
    if (usable(okx) && (tapeIsFresh(okx.bars, tf, nowSec) || !usable(kraken))) {
      const why = usable(kraken) ? "Kraken desactualizado" : kraken.diagnostic?.error ?? "Kraken sin cinta";
      return packLive(okx.bars, `${why}. Respaldo ${okx.bars[0]?.source ?? "okx"}. Vela abierta excluida. NET UNKNOWN.`, null, attempts);
    }
    if (usable(kraken)) {
      return packLive(kraken.bars, `Fuente ${kraken.bars[0]?.source ?? "kraken"}. Vela abierta excluida. NET UNKNOWN.`, null, attempts);
    }
    return packFail(
      "Fuente live no disponible o insuficiente. ESPERAR. NET UNKNOWN.",
      kraken.diagnostic ?? okx.diagnostic,
      null,
      attempts,
    );
  }

  const yahoo = await loadYahoo(asset, tf, requestSource);
  attempts.push(describeAttempt("yahoo", yahoo, tf, nowSec));
  if (usable(yahoo) && tapeIsFresh(yahoo.bars, tf, nowSec)) {
    return packLive(yahoo.bars, `Fuente ${yahoo.bars[0]?.source ?? "yahoo"}. Vela abierta excluida. NET UNKNOWN.`, yahoo.yahooFetch, attempts);
  }
  const okx = await loadOkx(asset, tf);
  attempts.push(describeAttempt("okx", okx, tf, nowSec));
  if (usable(okx) && (tapeIsFresh(okx.bars, tf, nowSec) || !usable(yahoo))) {
    const why = yahoo.diagnostic
      ? `Yahoo ${yahoo.diagnostic.error ?? yahoo.diagnostic.cause}${yahoo.diagnostic.httpStatus != null ? ` HTTP ${yahoo.diagnostic.httpStatus}` : ""}`
      : "Yahoo desactualizado";
    return packLive(
      okx.bars,
      `${why}. Respaldo ${okx.bars[0]?.source ?? "okx"}. Vela abierta excluida. NET UNKNOWN.`,
      yahoo.yahooFetch,
      attempts,
    );
  }
  if (usable(yahoo)) {
    return packLive(yahoo.bars, `Fuente ${yahoo.bars[0]?.source ?? "yahoo"}. Vela abierta excluida. NET UNKNOWN.`, yahoo.yahooFetch, attempts);
  }
  return packFail(
    "Fuente live no disponible o insuficiente. ESPERAR. NET UNKNOWN.",
    yahoo.diagnostic ?? okx.diagnostic,
    yahoo.yahooFetch,
    attempts,
  );
}
