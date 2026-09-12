import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { excludeOpenBars, ohlcValid, sanitizeBars, detectGaps, discoveryStatus } from "./shadow-discovery-bars.ts";
import { paginateNativeSeries, type NativePageFetcher } from "./shadow-discovery-ingest.ts";
import type { DiscoveryBar } from "./shadow-discovery-types.ts";

function candle(t: number, px = 100) {
  return { t, o: px, h: px + 1, l: px - 1, c: px + 0.2, v: 3 };
}

describe("native pagination hygiene", () => {
  it("merges pages without duplicates and keeps UTC open-time order", async () => {
    const pages: Record<string, number[]> = {
      newest: [10_000, 9_100, 8_200],
      older: [8_200, 7_300, 6_400],
    };
    let calls = 0;
    const fetchPage: NativePageFetcher = async ({ beforeOpenSec }) => {
      calls += 1;
      const times = beforeOpenSec == null ? pages.newest : pages.older;
      return {
        candles: times.map((t) => candle(t)),
        source: "test",
        instrument: "BTCUSDT",
        kind: "proxy-usdt-kline",
      };
    };
    const a = await paginateNativeSeries({
      assetId: "BTCUSD", tf: "15m", beforeOpenSec: null, nowSec: 20_000, pages: 2, pageSize: 3, fetchPage,
    });
    const ids = a.bars.map((b) => b.t);
    assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 5);
    assert.equal(calls, 2);
  });

  it("second identical ingest is idempotent at sanitize layer", async () => {
    const fetchPage: NativePageFetcher = async () => ({
      candles: [candle(1000), candle(1900), candle(1900)],
      source: "test", instrument: "BTCUSDT", kind: "proxy-usdt-kline",
    });
    const a = await paginateNativeSeries({
      assetId: "BTCUSD", tf: "15m", beforeOpenSec: null, nowSec: 5000, pages: 1, pageSize: 3, fetchPage,
    });
    const b = await paginateNativeSeries({
      assetId: "BTCUSD", tf: "15m", beforeOpenSec: null, nowSec: 5000, pages: 1, pageSize: 3, fetchPage,
    });
    const merged = sanitizeBars([...a.bars, ...b.bars]);
    assert.equal(merged.length, a.bars.length);
  });

  it("drops the forming bar", () => {
    const open: DiscoveryBar = {
      assetId: "BTCUSD", tf: "15m", t: 1000, o: 1, h: 2, l: 0.5, c: 1, v: 1, source: "t",
    };
    assert.equal(excludeOpenBars([open], 1899).length, 0);
    assert.equal(excludeOpenBars([open], 1900).length, 1);
  });

  it("Binance 1000 raw with one forming bar is not exhausted (999 mapped)", async () => {
    const step = 900;
    const newest = 1_000_000;
    const nowSec = newest + 60;
    const raw = Array.from({ length: 1000 }, (_, i) => candle(newest - (999 - i) * step));
    let calls = 0;
    const fetchPage: NativePageFetcher = async ({ beforeOpenSec, limit }) => {
      calls += 1;
      assert.equal(limit, 1000);
      const candles = beforeOpenSec == null
        ? raw
        : Array.from({ length: 1000 }, (_, i) => candle((beforeOpenSec - step) - (999 - i) * step));
      return { candles, source: "Binance BTCUSDT", instrument: "BTCUSDT", kind: "proxy-usdt-kline" };
    };
    const got = await paginateNativeSeries({
      assetId: "BTCUSD", tf: "15m", beforeOpenSec: null, nowSec, pages: 1, pageSize: 1000, fetchPage,
    });
    assert.equal(raw.length, 1000);
    assert.equal(got.bars.length, 999);
    assert.equal(got.exhausted, false);
    assert.equal(calls, 1);
  });

  it("OKX 300 raw with one forming bar is not exhausted (299 mapped)", async () => {
    const step = 900;
    const newest = 2_000_000;
    const nowSec = newest + 60;
    const raw = Array.from({ length: 300 }, (_, i) => candle(newest - (299 - i) * step));
    const fetchPage: NativePageFetcher = async () => ({
      candles: raw, source: "OKX XAU-USDT-SWAP", instrument: "XAU-USDT-SWAP", kind: "proxy-swap",
    });
    const got = await paginateNativeSeries({
      assetId: "XAUUSD", tf: "15m", beforeOpenSec: null, nowSec, pages: 1, pageSize: 300, fetchPage,
    });
    assert.equal(got.bars.length, 299);
    assert.equal(got.exhausted, false);
  });

  it("Bitget 200 raw with one forming bar is not exhausted (199 mapped)", async () => {
    const step = 900;
    const newest = 3_000_000;
    const nowSec = newest + 60;
    const raw = Array.from({ length: 200 }, (_, i) => candle(newest - (199 - i) * step));
    const fetchPage: NativePageFetcher = async () => ({
      candles: raw, source: "Bitget NDX100USDT", instrument: "NDX100USDT", kind: "proxy-swap",
    });
    const got = await paginateNativeSeries({
      assetId: "US100", tf: "15m", beforeOpenSec: null, nowSec, pages: 1, pageSize: 200, fetchPage,
    });
    assert.equal(got.bars.length, 199);
    assert.equal(got.exhausted, false);
  });

  it("a genuinely short raw page marks exhausted (199 raw, limit 200)", async () => {
    const step = 900;
    const newest = 4_000_000;
    const nowSec = newest + 10_000;
    const raw = Array.from({ length: 199 }, (_, i) => candle(newest - (198 - i) * step));
    const fetchPage: NativePageFetcher = async () => ({
      candles: raw, source: "Bitget CLUSDT", instrument: "CLUSDT", kind: "proxy-swap",
    });
    const got = await paginateNativeSeries({
      assetId: "WTI", tf: "15m", beforeOpenSec: null, nowSec, pages: 8, pageSize: 200, fetchPage,
    });
    assert.equal(raw.length, 199);
    assert.equal(got.bars.length, 199);
    assert.equal(got.exhausted, true);
    assert.equal(got.pages, 1);
  });

  it("full raw page continues pagination after dropping the forming bar", async () => {
    const step = 900;
    const newest = 5_000_000;
    const nowSec = newest + 60;
    let calls = 0;
    const fetchPage: NativePageFetcher = async ({ beforeOpenSec, limit }) => {
      calls += 1;
      const end = beforeOpenSec == null ? newest : beforeOpenSec - step;
      return {
        candles: Array.from({ length: limit }, (_, i) => candle(end - (limit - 1 - i) * step)),
        source: "Binance BTCUSDT", instrument: "BTCUSDT", kind: "proxy-usdt-kline",
      };
    };
    const got = await paginateNativeSeries({
      assetId: "BTCUSD", tf: "15m", beforeOpenSec: null, nowSec, pages: 2, pageSize: 1000, fetchPage,
    });
    assert.equal(calls, 2);
    assert.equal(got.pages, 2);
    assert.equal(got.exhausted, false);
    assert.ok(got.bars.length > 999);
  });

  it("does not fill gaps", () => {
    const a: DiscoveryBar = { assetId: "XAUUSD", tf: "30m", t: 1800, o: 1, h: 2, l: 1, c: 1, v: 1, source: "t" };
    const c: DiscoveryBar = { ...a, t: 1800 + 3 * 1800 };
    const gaps = detectGaps([a, c], "30m");
    assert.equal(gaps[0]!.missing, 2);
    assert.equal(sanitizeBars([a, c]).length, 2);
  });

  it("rejects invalid OHLC", () => {
    assert.equal(ohlcValid({ o: 2, h: 1, l: 3, c: 2 }), false);
  });

  it("never resamples 15m into 30m", () => {
    const src = readFileSync(new URL("./shadow-discovery-ingest.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /resample\(|aggregate15|from15m/i);
  });

  it("grades 1m/5m as C/D never A", () => {
    assert.equal(discoveryStatus({ bars: 5000, calendarDays: 200, tf: "1m" }), "C");
    assert.equal(discoveryStatus({ bars: 0, calendarDays: 0, tf: "15m" }), "D");
    assert.equal(discoveryStatus({ bars: 6000, calendarDays: 100, tf: "15m" }), "A");
  });
});
