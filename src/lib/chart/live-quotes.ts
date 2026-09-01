import { useEffect, useState } from "react";
import type { AssetId } from "../trading/types";
import { parseBinanceAggTrade, parseBitgetTicker, unwrapBinancePayload } from "./stream";
import { LIVE_REST_MS, type LiveQuoteSource, wsTickIsFresh } from "./quote-view";

export type LiveQuoteMap = Partial<Record<AssetId, number>>;
export type LiveQuoteSources = Partial<Record<AssetId, LiveQuoteSource>>;

const ASSET_IDS: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];

const BITGET_INST: Record<AssetId, string> = {
  XAUUSD: "XAUUSDT",
  BTCUSD: "BTCUSDT",
  US100: "NDX100USDT",
  WTI: "CLUSDT",
};

const INST_TO_ASSET: Record<string, AssetId> = {
  XAUUSDT: "XAUUSD",
  BTCUSDT: "BTCUSD",
  NDX100USDT: "US100",
  CLUSDT: "WTI",
};

const BITGET_WS = "wss://ws.bitget.com/v2/ws/public";
const BINANCE_WS = [
  "wss://data-stream.binance.vision/ws/btcusdt@aggTrade",
  "wss://stream.binance.com:9443/ws/btcusdt@aggTrade",
] as const;

let quotes: LiveQuoteMap = {};
let sources: LiveQuoteSources = {};
let lastWsAt: Partial<Record<AssetId, number>> = {};
const listeners = new Set<() => void>();
let refs = 0;
let bitget: WebSocket | null = null;
let binance: WebSocket | null = null;
let pingId = 0;
let retryId = 0;
let btcRetryId = 0;
let watchId = 0;
let raf = 0;
let btcHost = 0;
let dead = true;
let paused = false;
let restInflight = false;
let lastRestAt = 0;

function notify() {
  if (typeof requestAnimationFrame !== "function") {
    for (const fn of listeners) fn();
    return;
  }
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    for (const fn of listeners) fn();
  });
}

export function applyLiveQuote(id: AssetId, price: number, source: LiveQuoteSource = "ws"): boolean {
  if (!(price > 0) || !Number.isFinite(price)) return false;
  const now = Date.now();
  if (source === "rest" && wsTickIsFresh(lastWsAt[id], now)) return false;
  if (source === "ws") lastWsAt[id] = now;
  const srcChanged = sources[id] !== source;
  if (quotes[id] === price && !srcChanged) return false;
  quotes = { ...quotes, [id]: price };
  sources = { ...sources, [id]: source };
  notify();
  return true;
}

export function liveQuotesSnapshot(): LiveQuoteMap {
  return quotes;
}

export function liveQuoteSources(): LiveQuoteSources {
  return sources;
}

export function assetIdFromTicker(instId: string): AssetId | null {
  return INST_TO_ASSET[instId] ?? null;
}

function ingestBitget(raw: string) {
  if (raw === "pong" || raw === "ping") return;
  try {
    const parsed = parseBitgetTicker(JSON.parse(raw));
    if (!parsed) return;
    const id = assetIdFromTicker(parsed.instId);
    if (id) applyLiveQuote(id, parsed.price, "ws");
  } catch {
    /* ignore malformed */
  }
}

function ingestBinance(raw: string) {
  try {
    const t = parseBinanceAggTrade(unwrapBinancePayload(JSON.parse(raw)));
    if (t) applyLiveQuote("BTCUSD", t.price, "ws");
  } catch {
    /* ignore */
  }
}

function detach(sock: WebSocket | null) {
  if (!sock) return;
  sock.onopen = null;
  sock.onmessage = null;
  sock.onerror = null;
  sock.onclose = null;
  try {
    sock.close();
  } catch {
    /* ignore */
  }
}

function stopPing() {
  if (pingId) {
    window.clearInterval(pingId);
    pingId = 0;
  }
}

function stopWatch() {
  if (watchId) {
    window.clearInterval(watchId);
    watchId = 0;
  }
}

async function pullRestTickers() {
  if (dead || paused || restInflight) return;
  const now = Date.now();
  if (now - lastRestAt < LIVE_REST_MS) return;
  const stale = ASSET_IDS.some((id) => !wsTickIsFresh(lastWsAt[id], now));
  if (!stale) return;
  restInflight = true;
  lastRestAt = now;
  try {
    const { getVisualTickers } = await import("@/lib/market/live-ticker.fn");
    const rows = await getVisualTickers();
    const at = Date.now();
    for (const id of ASSET_IDS) {
      if (wsTickIsFresh(lastWsAt[id], at)) continue;
      const price = rows[id];
      if (price != null) applyLiveQuote(id, price, "rest");
      else if (sources[id] !== "snapshot") {
        sources = { ...sources, [id]: "snapshot" };
        notify();
      }
    }
  } catch {
    const at = Date.now();
    for (const id of ASSET_IDS) {
      if (wsTickIsFresh(lastWsAt[id], at)) continue;
      if (sources[id] === "ws" || sources[id] == null) {
        sources = { ...sources, [id]: "snapshot" };
      }
    }
    notify();
  } finally {
    restInflight = false;
  }
}

function startWatch() {
  stopWatch();
  if (typeof window === "undefined") return;
  watchId = window.setInterval(() => {
    void pullRestTickers();
  }, 2_000);
}

function connectBitget() {
  if (dead || paused) return;
  detach(bitget);
  bitget = null;
  try {
    const sock = new WebSocket(BITGET_WS);
    bitget = sock;
    sock.onopen = () => {
      sock.send(
        JSON.stringify({
          op: "subscribe",
          args: (Object.keys(BITGET_INST) as AssetId[]).map((id) => ({
            instType: "USDT-FUTURES",
            channel: "ticker",
            instId: BITGET_INST[id],
          })),
        }),
      );
      stopPing();
      pingId = window.setInterval(() => {
        try {
          sock.send("ping");
        } catch {
          /* closed */
        }
      }, 25_000);
    };
    sock.onmessage = (ev) => ingestBitget(String(ev.data));
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
    };
    sock.onclose = () => {
      if (bitget === sock) bitget = null;
      stopPing();
      if (dead || paused) return;
      window.clearTimeout(retryId);
      retryId = window.setTimeout(connectBitget, 1200);
    };
  } catch {
    window.clearTimeout(retryId);
    retryId = window.setTimeout(connectBitget, 1200);
  }
}

function connectBinance() {
  if (dead || paused) return;
  detach(binance);
  binance = null;
  try {
    const sock = new WebSocket(BINANCE_WS[btcHost % BINANCE_WS.length]);
    binance = sock;
    sock.onmessage = (ev) => ingestBinance(String(ev.data));
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
    };
    sock.onclose = () => {
      if (binance === sock) binance = null;
      if (dead || paused) return;
      btcHost += 1;
      window.clearTimeout(btcRetryId);
      btcRetryId = window.setTimeout(connectBinance, 1200);
    };
  } catch {
    window.clearTimeout(btcRetryId);
    btcRetryId = window.setTimeout(connectBinance, 1200);
  }
}

function onVis() {
  if (dead) return;
  if (document.hidden) {
    paused = true;
    stopPing();
    stopWatch();
    window.clearTimeout(retryId);
    window.clearTimeout(btcRetryId);
    detach(bitget);
    bitget = null;
    detach(binance);
    binance = null;
    return;
  }
  paused = false;
  connectBitget();
  connectBinance();
  startWatch();
}

function startQuotes() {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") return;
  refs += 1;
  if (refs !== 1) return;
  dead = false;
  paused = typeof document !== "undefined" && document.hidden;
  document.addEventListener("visibilitychange", onVis);
  if (!paused) {
    connectBitget();
    connectBinance();
    startWatch();
  }
}

function stopQuotes() {
  refs = Math.max(0, refs - 1);
  if (refs > 0) return;
  dead = true;
  paused = false;
  if (typeof document === "undefined") return;
  document.removeEventListener("visibilitychange", onVis);
  stopPing();
  stopWatch();
  window.clearTimeout(retryId);
  window.clearTimeout(btcRetryId);
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  detach(bitget);
  bitget = null;
  detach(binance);
  binance = null;
}

export function useLiveQuotes(): LiveQuoteMap {
  const [map, setMap] = useState<LiveQuoteMap>(() => quotes);
  useEffect(() => {
    const fn = () => setMap(quotes);
    listeners.add(fn);
    startQuotes();
    fn();
    return () => {
      listeners.delete(fn);
      stopQuotes();
    };
  }, []);
  return map;
}

export function useLiveQuoteSources(): LiveQuoteSources {
  const [map, setMap] = useState<LiveQuoteSources>(() => sources);
  useEffect(() => {
    const fn = () => setMap(sources);
    listeners.add(fn);
    startQuotes();
    fn();
    return () => {
      listeners.delete(fn);
      stopQuotes();
    };
  }, []);
  return map;
}
