import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyTradeToLast, foldLiveLast, mergeBar, mergeKlineIntoOpen } from "./bars.ts";
import type { Candle } from "../trading/types.ts";
import { parseBinanceAggTrade, parseBinanceKline, unwrapBinancePayload } from "./stream.ts";

function bar(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

describe("live bar merge", () => {
  it("updates the current bar in place", () => {
    const prev = [bar(1, 10), bar(2, 11)];
    const next = mergeBar(prev, bar(2, 12));
    assert.equal(next.length, 2);
    assert.equal(next[1]!.close, 12);
    assert.equal(prev[1]!.close, 11);
  });

  it("appends only a newer bar", () => {
    const prev = [bar(1, 10)];
    const next = mergeBar(prev, bar(2, 11));
    assert.equal(next.length, 2);
    assert.equal(mergeBar(next, bar(1, 9)).length, 2);
  });

  it("history reload keeps a newer live last candle", () => {
    const hist = [bar(1, 10), bar(2, 11)];
    const folded = foldLiveLast(hist, bar(2, 11.5));
    assert.equal(folded.at(-1)!.close, 11.5);
    const withNew = foldLiveLast(hist, bar(3, 12));
    assert.equal(withNew.length, 3);
  });
});

describe("real trade ticks on the open bar", () => {
  it("moves high/low/close of the current M1 bar", () => {
    const last = { time: 1_000, open: 10, high: 11, low: 9.5, close: 10.2, volume: 3 };
    const up = applyTradeToLast(last, 11.4, 1_010, 60);
    assert.ok(up);
    assert.equal(up.high, 11.4);
    assert.equal(up.close, 11.4);
    assert.equal(up.open, 10);
    const down = applyTradeToLast(up, 9.1, 1_020, 60);
    assert.ok(down);
    assert.equal(down.low, 9.1);
    assert.equal(down.close, 9.1);
    assert.equal(down.high, 11.4);
  });

  it("does not invent a new bar when the trade falls after the close", () => {
    const last = bar(1_000, 10);
    assert.equal(applyTradeToLast(last, 11, 1_060, 60), null);
    assert.equal(applyTradeToLast(last, 11, 900, 60), null);
  });

  it("ignores a trade that does not change the candle", () => {
    const last = { time: 1_000, open: 10, high: 11, low: 9, close: 10.5, volume: 1 };
    const same = applyTradeToLast(last, 10.5, 1_010, 60);
    assert.equal(same, last);
  });
});

describe("kline must not rewind a newer trade", () => {
  it("keeps trade close when kline event is older", () => {
    const last = { time: 1_000, open: 10, high: 11.4, low: 9.5, close: 11.4, volume: 3 };
    const kline = { time: 1_000, open: 10, high: 11.1, low: 9.6, close: 10.8, volume: 5 };
    const changed = mergeKlineIntoOpen(last, kline, 1_020, 1_015);
    assert.equal(changed, true);
    assert.equal(last.close, 11.4);
    assert.equal(last.high, 11.4);
    assert.equal(last.low, 9.5);
    assert.equal(last.volume, 5);
  });

  it("takes kline close when it is at least as new as the last trade", () => {
    const last = { time: 1_000, open: 10, high: 11, low: 9, close: 10.2, volume: 1 };
    const kline = { time: 1_000, open: 10, high: 11.2, low: 8.9, close: 11.0, volume: 2 };
    const changed = mergeKlineIntoOpen(last, kline, 1_010, 1_012);
    assert.equal(changed, true);
    assert.equal(last.close, 11.0);
    assert.equal(last.high, 11.2);
    assert.equal(last.low, 8.9);
  });
});

describe("binance combined stream parse", () => {
  it("unwraps combined envelope and reads aggTrade", () => {
    const wrapped = {
      stream: "btcusdt@aggTrade",
      data: { e: "aggTrade", p: "77890.12", T: 1_700_000_123_456 },
    };
    const inner = unwrapBinancePayload(wrapped);
    const t = parseBinanceAggTrade(inner);
    assert.ok(t);
    assert.equal(t.price, 77890.12);
    assert.equal(t.ts, 1_700_000_123);
  });

  it("parses kline from combined envelope", () => {
    const wrapped = {
      stream: "btcusdt@kline_1m",
      data: {
        E: 1_700_000_160_000,
        k: { t: 1_700_000_100_000, o: "10", h: "11", l: "9", c: "10.5", v: "3", x: false },
      },
    };
    const k = parseBinanceKline(unwrapBinancePayload(wrapped));
    assert.ok(k);
    assert.equal(k.candle.close, 10.5);
    assert.equal(k.candle.time, 1_700_000_100);
    assert.equal(k.closed, false);
    assert.equal(k.eventTs, 1_700_000_160);
  });
});