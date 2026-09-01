import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyLiveQuote,
  applyXauSpot,
  assetIdFromTicker,
  liveQuotesSnapshot,
  liveXauSpot,
  liveXauSpotAt,
  parseGoldApiSpot,
  subscribeLiveQuotes,
  XAU_SPOT_POLL_MS,
} from "./live-quotes.ts";
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

  it("US100 prefers markPrice over a stale lastPr", () => {
    const row = parseBitgetTicker({
      arg: { channel: "ticker", instId: "NDX100USDT" },
      data: [{ instId: "NDX100USDT", lastPr: "29235", markPrice: "29195", bidPr: "29197", askPr: "29198", indexPrice: "29155.23" }],
    });
    assert.equal(row?.instId, "NDX100USDT");
    assert.equal(row?.price, 29195);
  });

  it("US100 falls back bid/ask then index then lastPr", () => {
    assert.equal(
      parseBitgetTicker({
        data: [{ instId: "NDX100USDT", lastPr: "29235", bidPr: "29197", askPr: "29199", indexPrice: "29155" }],
      })?.price,
      29198,
    );
    assert.equal(
      parseBitgetTicker({
        data: [{ instId: "NDX100USDT", lastPr: "29235", indexPrice: "29155.5" }],
      })?.price,
      29155.5,
    );
    assert.equal(
      parseBitgetTicker({
        data: [{ instId: "NDX100USDT", lastPr: "29235" }],
      })?.price,
      29235,
    );
  });

  it("does not apply the US100 markPrice rule to XAU/WTI/BTC", () => {
    assert.equal(
      parseBitgetTicker({
        data: [{ instId: "XAUUSDT", lastPr: "4384.27", markPrice: "4380" }],
      })?.price,
      4384.27,
    );
    assert.equal(
      parseBitgetTicker({
        data: [{ instId: "CLUSDT", lastPr: "87.71", markPrice: "87.5" }],
      })?.price,
      87.71,
    );
    assert.equal(
      parseBitgetTicker({
        data: [{ instId: "BTCUSDT", lastPr: "77976.2", markPrice: "77900" }],
      })?.price,
      77976.2,
    );
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

  it("does not let REST overwrite a fresh WebSocket tick", () => {
    assert.equal(applyLiveQuote("WTI", 87.5, "ws"), true);
    assert.equal(applyLiveQuote("WTI", 87.1, "rest"), false);
    assert.equal(liveQuotesSnapshot().WTI, 87.5);
  });

  it("exposes a shared live subscription without inventing ticks", () => {
    assert.equal(typeof subscribeLiveQuotes, "function");
    let n = 0;
    const off = subscribeLiveQuotes(() => {
      n += 1;
    });
    assert.ok(n >= 1);
    off();
  });
});

describe("XAU spot vs proxy stores", () => {
  it("polls gold-api every 12s", () => {
    assert.equal(XAU_SPOT_POLL_MS, 12_000);
  });

  it("keeps Bitget last and gold-api spot in separate slots", () => {
    assert.equal(applyLiveQuote("XAUUSD", 4361.13, "ws"), true);
    assert.equal(liveQuotesSnapshot().XAUUSD, 4361.13);
    assert.equal(applyXauSpot(4354.2), true);
    assert.equal(liveXauSpot(), 4354.2);
    assert.notEqual(liveXauSpot(), liveQuotesSnapshot().XAUUSD);
    assert.equal(applyXauSpot(4354.2), false);
    assert.equal(liveXauSpot(), 4354.2);
    assert.ok(liveXauSpotAt() > 0);
  });

  it("does not let Bitget last/mark replace the last valid spot", () => {
    assert.equal(applyXauSpot(4355.1), true);
    assert.equal(applyLiveQuote("XAUUSD", 4362.0, "ws"), true);
    assert.equal(liveXauSpot(), 4355.1);
    assert.equal(liveQuotesSnapshot().XAUUSD, 4362.0);
  });

  it("parses gold-api JSON and rejects junk", () => {
    assert.equal(parseGoldApiSpot({ price: 4355.200195 }), 4355.200195);
    assert.equal(parseGoldApiSpot({ price: 0 }), null);
    assert.equal(parseGoldApiSpot({ price: "no" }), null);
    assert.equal(parseGoldApiSpot(null), null);
  });
});
