import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyLiveQuote, assetIdFromTicker, liveQuotesSnapshot } from "./live-quotes.ts";
import { parseBinanceAggTrade, parseBitgetTicker, unwrapBinancePayload } from "./stream.ts";

describe("live quote parsers", () => {
  it("maps Bitget ticker lastPr to Atalaya assets", () => {
    const row = parseBitgetTicker({
      arg: { channel: "ticker", instId: "XAUUSDT" },
      data: [{ instId: "XAUUSDT", lastPr: "3512.45" }],
    });
    assert.equal(row?.instId, "XAUUSDT");
    assert.equal(row?.price, 3512.45);
    assert.equal(assetIdFromTicker("XAUUSDT"), "XAUUSD");
    assert.equal(assetIdFromTicker("NDX100USDT"), "US100");
    assert.equal(assetIdFromTicker("CLUSDT"), "WTI");
    assert.equal(assetIdFromTicker("BTCUSDT"), "BTCUSD");
    assert.equal(assetIdFromTicker("FOO"), null);
  });

  it("rejects non-positive Bitget prices", () => {
    assert.equal(parseBitgetTicker({ data: [{ instId: "BTCUSDT", lastPr: "0" }] }), null);
    assert.equal(parseBitgetTicker({ data: [{ instId: "BTCUSDT", lastPr: "abc" }] }), null);
    assert.equal(parseBitgetTicker({ data: [] }), null);
  });

  it("reads Binance aggTrade last price without inventing ticks", () => {
    const t = parseBinanceAggTrade({ p: "64012.3", T: 1_700_000_000_123 });
    assert.equal(t?.price, 64012.3);
    assert.equal(parseBinanceAggTrade({ p: "-1", T: 1 }), null);
    const wrapped = unwrapBinancePayload({ stream: "btcusdt@aggTrade", data: { p: "1.5", T: 2 } });
    assert.equal(parseBinanceAggTrade(wrapped)?.price, 1.5);
  });
});

describe("live quote store", () => {
  it("keeps the last real price and ignores duplicates", () => {
    assert.equal(applyLiveQuote("BTCUSD", 100), true);
    assert.equal(liveQuotesSnapshot().BTCUSD, 100);
    assert.equal(applyLiveQuote("BTCUSD", 100), false);
    assert.equal(applyLiveQuote("BTCUSD", 0), false);
    assert.equal(applyLiveQuote("BTCUSD", Number.NaN), false);
    assert.equal(applyLiveQuote("BTCUSD", 101.25), true);
    assert.equal(liveQuotesSnapshot().BTCUSD, 101.25);
  });
});
