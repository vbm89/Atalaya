import { useCallback, useEffect, useRef, useState } from "react";
import { getChartTick } from "@/lib/market/chart.fn";
import type { Candle } from "@/lib/trading/types";
import type { ChartSeries, ChartTf, LiveStatus } from "./types";
import { applyTradeInPlace, foldLiveLast, mergeKlineIntoOpen, patchLastBar, tfSeconds } from "./bars";
import { parseBinanceAggTrade, parseBinanceKline, unwrapBinancePayload } from "./stream";

const BINANCE_WS_BASES = [
  "wss://data-stream.binance.vision/ws",
  "wss://stream.binance.com:9443/ws",
] as const;

const BINANCE_TF: Record<ChartTf, string> = {
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

const BITGET_CH: Record<ChartTf, string> = {
  "1m": "candle1m",
  "5m": "candle5m",
  "15m": "candle15m",
  "30m": "candle30m",
  "1h": "candle1H",
  "4h": "candle4H",
  "1d": "candle1D",
  "1w": "candle1W",
  "1M": "candle1M",
};

export type TickHandler = (candle: Candle, isNewBar: boolean) => void;

function seriesKey(series: ChartSeries | undefined): string {
  return series ? `${series.assetId}:${series.tf}` : "";
}

function parseBitgetRow(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 5) return null;
  const time = Math.floor(Number(row[0]) / (Number(row[0]) > 1e12 ? 1000 : 1));
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
}

export function useChartLive(series: ChartSeries | undefined) {
  const key = seriesKey(series);
  const seed = series?.candles ?? [];
  const [ownedKey, setOwnedKey] = useState(key);
  const [bars, setBars] = useState<Candle[]>(seed);
  const [status, setStatus] = useState<LiveStatus>(
    series && !series.sessionOpen ? "closed" : "connecting",
  );
  const [nonce, setNonce] = useState(0);
  const barsRef = useRef<Candle[]>(seed);
  const listenersRef = useRef(new Set<TickHandler>());
  const statusRef = useRef(status);
  const hzRef = useRef(0);

  if (key !== ownedKey) {
    setOwnedKey(key);
    barsRef.current = seed;
    setBars(seed);
    const next = series && !series.sessionOpen ? "closed" : "connecting";
    statusRef.current = next;
    setStatus(next);
  }

  const subscribe = useCallback((fn: TickHandler) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  const getBars = useCallback(() => barsRef.current, []);
  const getTickHz = useCallback(() => hzRef.current, []);

  useEffect(() => {
    if (!series?.candles.length) return;
    if (seriesKey(series) !== ownedKey) return;
    const folded = foldLiveLast(series.candles, barsRef.current.at(-1));
    const lenChanged = folded.length !== barsRef.current.length;
    barsRef.current = folded;
    if (lenChanged) setBars(folded);
  }, [series?.candles, series?.assetId, series?.tf, series?.lastBarAt, ownedKey]);

  useEffect(() => {
    if (!series || seriesKey(series) !== ownedKey) return;
    if (!series.sessionOpen) {
      statusRef.current = "closed";
      setStatus("closed");
      return;
    }

    const assetId = series.assetId;
    const tf = series.tf;
    const streamKind = series.streamKind;
    const streamSymbol = series.streamSymbol;
    const tfSec = tfSeconds(tf);

    let dead = false;
    let paused = typeof document !== "undefined" && document.hidden;
    let ws: WebSocket | null = null;
    let tradeWs: WebSocket | null = null;
    let pingId = 0;
    let retryId = 0;
    let tradeRetryId = 0;
    let pollId = 0;
    let hzId = 0;
    let ticksInWindow = 0;
    let backoff = 800;
    let lastTradeTs = 0;
    let raf = 0;
    let pending: Candle | null = null;
    let pendingNew = false;
    let pollWatch = 0;
    let wsHost = 0;

    const pushStatus = (s: LiveStatus) => {
      if (statusRef.current === s) return;
      statusRef.current = s;
      setStatus(s);
    };

    const flush = () => {
      raf = 0;
      const c = pending;
      const n = pendingNew;
      pending = null;
      pendingNew = false;
      if (!c) return;
      for (const fn of listenersRef.current) {
        try {
          fn(c, n);
        } catch {
          /* listener must not break the feed */
        }
      }
    };

    const emit = (c: Candle, isNewBar: boolean) => {
      ticksInWindow += 1;
      pending = c;
      if (isNewBar) pendingNew = true;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    const applyCandle = (c: Candle, eventTs = 0) => {
      if (![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite)) return;
      const prev = barsRef.current;
      const last = prev.at(-1);
      if (last && c.time < last.time) return;
      if (last && last.time === c.time) {
        if (!mergeKlineIntoOpen(last, c, lastTradeTs, eventTs)) return;
        emit(last, false);
        return;
      }
      const isNewBar = patchLastBar(prev, c);
      barsRef.current = prev;
      emit(isNewBar ? c : (prev.at(-1) ?? c), isNewBar);
      if (isNewBar) setBars(prev.slice());
    };

    const applyTrade = (price: number, tradeTime: number) => {
      const last = barsRef.current.at(-1);
      if (!last) return;
      if (!applyTradeInPlace(last, price, tradeTime, tfSec)) return;
      lastTradeTs = tradeTime;
      emit(last, false);
    };

    const stopPoll = () => {
      if (pollId) {
        window.clearInterval(pollId);
        pollId = 0;
      }
    };
    const stopPollWatch = () => {
      if (pollWatch) {
        window.clearTimeout(pollWatch);
        pollWatch = 0;
      }
    };
    const armPollWatch = () => {
      stopPollWatch();
      pollWatch = window.setTimeout(() => {
        pollWatch = 0;
        if (!dead && !paused && statusRef.current !== "live") startPoll();
      }, 2500);
    };
    const stopRetry = () => {
      if (retryId) {
        window.clearTimeout(retryId);
        retryId = 0;
      }
    };
    const stopTradeRetry = () => {
      if (tradeRetryId) {
        window.clearTimeout(tradeRetryId);
        tradeRetryId = 0;
      }
    };
    const stopPing = () => {
      if (pingId) {
        window.clearInterval(pingId);
        pingId = 0;
      }
    };
    const detach = (sock: WebSocket | null) => {
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
    };
    const closeWs = () => {
      stopPing();
      stopTradeRetry();
      detach(ws);
      ws = null;
      detach(tradeWs);
      tradeWs = null;
    };

    const startPoll = () => {
      if (pollId || dead || paused) return;
      const tick = async () => {
        if (dead || paused) return;
        try {
          const r = await getChartTick({ data: { assetId, tf } });
          if (dead || paused) return;
          if (!r.sessionOpen) {
            pushStatus("closed");
            stopPoll();
            closeWs();
            return;
          }
          if (r.candle) {
            applyCandle(r.candle, Math.floor(Date.now() / 1000));
            pushStatus("live");
          }
        } catch {
          if (!dead && !paused) pushStatus("offline");
        }
      };
      void tick();
      pollId = window.setInterval(() => void tick(), 2000);
    };

    const scheduleReconnect = () => {
      if (dead || paused) return;
      stopRetry();
      retryId = window.setTimeout(() => {
        if (!dead && !paused) connect();
      }, backoff);
      backoff = Math.min(backoff * 2, 12_000);
    };

    const handleBinanceMessage = (ev: MessageEvent) => {
      try {
        const payload = unwrapBinancePayload(JSON.parse(String(ev.data)));
        const t = parseBinanceAggTrade(payload);
        if (t) {
          applyTrade(t.price, t.ts);
          if (!dead && !paused) pushStatus("live");
          return;
        }
        const k = parseBinanceKline(payload);
        if (k) {
          applyCandle(k.candle, k.eventTs);
          if (!dead && !paused) pushStatus("live");
        }
      } catch {
        /* ignore malformed */
      }
    };

    const binanceUrl = (stream: string) =>
      `${BINANCE_WS_BASES[wsHost % BINANCE_WS_BASES.length]}/${stream}`;

    const connectTrades = () => {
      if (dead || paused || streamKind !== "binance" || !streamSymbol) return;
      detach(tradeWs);
      tradeWs = null;
      const sym = streamSymbol.toLowerCase();
      try {
        const sock = new WebSocket(binanceUrl(`${sym}@aggTrade`));
        tradeWs = sock;
        sock.onmessage = handleBinanceMessage;
        sock.onerror = () => {
          try {
            sock.close();
          } catch {
            /* ignore */
          }
        };
        sock.onclose = () => {
          if (tradeWs === sock) tradeWs = null;
          if (dead || paused) return;
          stopTradeRetry();
          tradeRetryId = window.setTimeout(connectTrades, 1200);
        };
      } catch {
        stopTradeRetry();
        tradeRetryId = window.setTimeout(connectTrades, 1200);
      }
    };

    const connect = () => {
      if (dead || paused) return;
      closeWs();
      stopPoll();
      if (!streamKind || !streamSymbol) {
        if (statusRef.current !== "live") pushStatus("connecting");
        startPoll();
        return;
      }
      if (statusRef.current !== "live") pushStatus("connecting");
      armPollWatch();
      try {
        if (streamKind === "binance") {
          const sym = streamSymbol.toLowerCase();
          ws = new WebSocket(binanceUrl(`${sym}@kline_${BINANCE_TF[tf]}`));
          ws.onopen = () => {
            backoff = 800;
            stopPollWatch();
            stopPoll();
            if (!dead && !paused) pushStatus("live");
            connectTrades();
          };
          ws.onmessage = handleBinanceMessage;
          ws.onerror = () => {
            try {
              ws?.close();
            } catch {
              /* ignore */
            }
          };
          ws.onclose = () => {
            if (dead || paused) return;
            wsHost += 1;
            armPollWatch();
            scheduleReconnect();
          };
          return;
        }

        ws = new WebSocket("wss://ws.bitget.com/v2/ws/public");
        ws.onopen = () => {
          backoff = 800;
          stopPollWatch();
          stopPoll();
          if (!dead && !paused) pushStatus("live");
          ws?.send(
            JSON.stringify({
              op: "subscribe",
              args: [
                {
                  instType: "USDT-FUTURES",
                  channel: BITGET_CH[tf],
                  instId: streamSymbol,
                },
              ],
            }),
          );
          pingId = window.setInterval(() => {
            try {
              ws?.send("ping");
            } catch {
              /* closed */
            }
          }, 25_000);
        };
        ws.onmessage = (ev) => {
          const raw = String(ev.data);
          if (raw === "pong" || raw === "ping") return;
          try {
            const msg = JSON.parse(raw) as { data?: unknown };
            const rows = Array.isArray(msg.data) ? msg.data : [];
            const c = parseBitgetRow(rows.at(-1));
            if (c) {
              applyCandle(c, Math.floor(Date.now() / 1000));
              if (!dead && !paused) pushStatus("live");
            }
          } catch {
            /* ignore */
          }
        };
        ws.onerror = () => {
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          stopPing();
          if (dead || paused) return;
          armPollWatch();
          scheduleReconnect();
        };
      } catch {
        startPoll();
        scheduleReconnect();
      }
    };

    const onVis = () => {
      if (dead) return;
      if (document.hidden) {
        paused = true;
        stopRetry();
        stopPollWatch();
        stopPoll();
        closeWs();
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        return;
      }
      paused = false;
      backoff = 800;
      connect();
    };

    hzId = window.setInterval(() => {
      hzRef.current = ticksInWindow;
      ticksInWindow = 0;
    }, 1000);

    if (paused) {
      pushStatus("connecting");
    } else {
      connect();
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(hzId);
      if (raf) cancelAnimationFrame(raf);
      stopPing();
      stopRetry();
      stopTradeRetry();
      stopPollWatch();
      stopPoll();
      closeWs();
    };
  }, [
    ownedKey,
    series?.assetId,
    series?.tf,
    series?.sessionOpen,
    series?.streamKind,
    series?.streamSymbol,
    nonce,
  ]);

  return {
    key: ownedKey,
    bars,
    status,
    reconnect: () => setNonce((n) => n + 1),
    subscribe,
    getBars,
    getTickHz,
  };
}
