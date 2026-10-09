/**
 * Capa única de Yahoo para el proceso del API.
 * No decide entradas. No guarda velas como si fueran nuevas.
 *
 * El TTL es 3 s: cubre un collector y una UI que piden el mismo símbolo
 * en la misma lectura, y caduca antes del siguiente ciclo de 20 s.
 * Así la segunda lectura de cierre sigue siendo una petición nueva.
 *
 * Un 429 activa cooldown de proveedor. Kraken no entra aquí.
 */
import type { FetchTrace } from "./data.ts";

export const YAHOO_CACHE_TTL_MS = 3_000;
export const YAHOO_DEFAULT_COOLDOWN_MS = 60_000;
export const YAHOO_MAX_COOLDOWN_MS = 120_000;
const BODY_SNIPPET_MAX = 160;

export interface YahooBrokerStats {
  yahooRequests: number;
  yahoo429: number;
  yahoo200: number;
  yahooOtherErrors: number;
  cacheHits: number;
  singleFlightHits: number;
  cooldownSkips: number;
}

export interface YahooFetchMeta {
  cacheHit: boolean;
  singleFlightHit: boolean;
  cooldownActive: boolean;
  external: boolean;
  retryAfterSec: number | null;
  requestSource: string | null;
}

interface CacheEntry {
  at: number;
  trace: FetchTrace;
}

const emptyStats = (): YahooBrokerStats => ({
  yahooRequests: 0,
  yahoo429: 0,
  yahoo200: 0,
  yahooOtherErrors: 0,
  cacheHits: 0,
  singleFlightHits: 0,
  cooldownSkips: 0,
});

let stats = emptyStats();
let cache = new Map<string, CacheEntry>();
let inflight = new Map<string, Promise<FetchTrace>>();
let cooldownUntil = 0;

export function getYahooBrokerStats(): YahooBrokerStats {
  return { ...stats };
}

export function resetYahooBrokerForTests(): void {
  stats = emptyStats();
  cache = new Map();
  inflight = new Map();
  cooldownUntil = 0;
}

export function parseRetryAfter(raw: string | null, nowMs: number): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    return Number.isFinite(sec) ? sec : null;
  }
  const when = Date.parse(trimmed);
  if (!Number.isFinite(when)) return null;
  return Math.ceil((when - nowMs) / 1000);
}

function cooldownMs(retryAfterSec: number | null): number {
  if (retryAfterSec == null || retryAfterSec <= 0) return YAHOO_DEFAULT_COOLDOWN_MS;
  return Math.min(retryAfterSec * 1000, YAHOO_MAX_COOLDOWN_MS);
}

function snippet(text: string): string | null {
  const clean = text.replace(/[\u0000-\u001f]/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, BODY_SNIPPET_MAX);
}

function cooldownTrace(url: string, nowMs: number): FetchTrace {
  const left = Math.max(0, Math.ceil((cooldownUntil - nowMs) / 1000));
  return {
    endpoint: url,
    httpStatus: 429,
    timeout: false,
    error: "HTTP 429",
    json: null,
    retryAfterSec: left,
    bodySnippet: null,
  };
}

async function execute(url: string, nowMs: number): Promise<FetchTrace> {
  stats.yahooRequests += 1;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) {
      const retryAfterSec = parseRetryAfter(res.headers.get("retry-after"), nowMs);
      let bodySnippet: string | null = null;
      try {
        bodySnippet = snippet(await res.text());
      } catch {
        bodySnippet = null;
      }
      const trace: FetchTrace = {
        endpoint: url,
        httpStatus: res.status,
        timeout: false,
        error: `HTTP ${res.status}`,
        json: null,
        retryAfterSec,
        bodySnippet,
      };
      if (res.status === 429) {
        stats.yahoo429 += 1;
        cache.clear();
        cooldownUntil = nowMs + cooldownMs(retryAfterSec);
      } else {
        stats.yahooOtherErrors += 1;
      }
      return trace;
    }
    stats.yahoo200 += 1;
    try {
      const json = await res.json();
      const trace: FetchTrace = {
        endpoint: url,
        httpStatus: res.status,
        timeout: false,
        error: null,
        json,
        retryAfterSec: null,
        bodySnippet: null,
      };
      if (json != null) cache.set(url, { at: nowMs, trace });
      return trace;
    } catch (error) {
      stats.yahooOtherErrors += 1;
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
    stats.yahooOtherErrors += 1;
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
    clearTimeout(timer);
  }
}

export async function fetchYahooChart(url: string, nowMs = Date.now()): Promise<{ trace: FetchTrace; meta: YahooFetchMeta }> {
  if (nowMs < cooldownUntil) {
    stats.cooldownSkips += 1;
    return {
      trace: cooldownTrace(url, nowMs),
      meta: {
        cacheHit: false,
        singleFlightHit: false,
        cooldownActive: true,
        external: false,
        retryAfterSec: Math.max(0, Math.ceil((cooldownUntil - nowMs) / 1000)),
        requestSource: null,
      },
    };
  }
  const cached = cache.get(url);
  if (cached && nowMs - cached.at < YAHOO_CACHE_TTL_MS && cached.trace.httpStatus === 200 && cached.trace.json != null) {
    stats.cacheHits += 1;
    return {
      trace: cached.trace,
      meta: { cacheHit: true, singleFlightHit: false, cooldownActive: false, external: false, retryAfterSec: null, requestSource: null },
    };
  }
  const pending = inflight.get(url);
  if (pending) {
    stats.singleFlightHits += 1;
    const trace = await pending;
    return {
      trace,
      meta: {
        cacheHit: false,
        singleFlightHit: true,
        cooldownActive: false,
        external: false,
        retryAfterSec: trace.retryAfterSec,
        requestSource: null,
      },
    };
  }
  const flight = execute(url, nowMs);
  inflight.set(url, flight);
  try {
    const trace = await flight;
    return {
      trace,
      meta: {
        cacheHit: false,
        singleFlightHit: false,
        cooldownActive: false,
        external: true,
        retryAfterSec: trace.retryAfterSec,
        requestSource: null,
      },
    };
  } finally {
    inflight.delete(url);
  }
}
