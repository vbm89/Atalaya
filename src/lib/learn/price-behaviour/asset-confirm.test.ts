import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assetConfirmFail } from "./asset-confirm.ts";
import { decide } from "./decide.ts";
import type { Bar, MarketState, StructureView } from "./types.ts";

function structure(partial: Partial<StructureView>): StructureView {
  return {
    swings: [],
    hh: false,
    hl: false,
    lh: false,
    ll: false,
    lastHigh: null,
    prevHigh: null,
    lastLow: null,
    prevLow: null,
    recentHigh: null,
    recentLow: null,
    rangeHigh: null,
    rangeLow: null,
    bosUp: false,
    bosDown: false,
    ...partial,
  };
}

const state: MarketState = { state: "TREND_UP", confidence: 1, evidence: [] };

describe("asset confirmation", () => {
  it("does not turn a fib touch into a signal by itself", () => {
    const bars: Bar[] = [
      { t: 0, o: 100, h: 101, l: 99, c: 100 },
      { t: 900, o: 100, h: 100.4, l: 99.7, c: 100.1 },
    ];
    const view = structure({
      hh: true,
      hl: true,
      lastHigh: { index: 0, price: 110, kind: "high", confirmIndex: 2 },
      lastLow: { index: 0, price: 100, kind: "low", confirmIndex: 2 },
    });
    const why = assetConfirmFail({
      asset: "XAUUSD",
      bars,
      i: 1,
      side: "LONG",
      setup: "SWEEP_RECLAIM",
      structure: view,
      state,
      events: [],
      atr: 1,
    });
    assert.equal(why, null);
  });

  it("rejects an XAU pullback that is not on 38.2, 50 or 61.8", () => {
    const bars: Bar[] = [{ t: 0, o: 109.6, h: 109.8, l: 109.4, c: 109.7 }];
    const view = structure({
      hh: true,
      hl: true,
      lastHigh: { index: 0, price: 110, kind: "high", confirmIndex: 2 },
      lastLow: { index: 0, price: 100, kind: "low", confirmIndex: 2 },
    });
    const why = assetConfirmFail({
      asset: "XAUUSD",
      bars,
      i: 0,
      side: "LONG",
      setup: "TREND_PULLBACK",
      structure: view,
      state,
      events: [],
      atr: 1,
    });
    assert.match(why ?? "", /38\.2/);
  });

  it("accepts an XAU pullback sitting on the 50 percent retracement", () => {
    const bars: Bar[] = [{ t: 0, o: 105.2, h: 105.4, l: 104.8, c: 105.1 }];
    const view = structure({
      hh: true,
      hl: true,
      lastHigh: { index: 0, price: 110, kind: "high", confirmIndex: 2 },
      lastLow: { index: 0, price: 100, kind: "low", confirmIndex: 2 },
    });
    const why = assetConfirmFail({
      asset: "XAUUSD",
      bars,
      i: 0,
      side: "LONG",
      setup: "TREND_PULLBACK",
      structure: view,
      state,
      events: [],
      atr: 1,
    });
    assert.equal(why, null);
  });

  it("leaves the live decision unchanged when the asset gate is off", () => {
    const bars: Bar[] = Array.from({ length: 60 }, (_, i) => ({
      t: 1_700_000_000 + i * 900,
      o: 100,
      h: 101,
      l: 99,
      c: 100,
    }));
    const off = decide(bars, 59, "XAUUSD");
    const forcedOff = decide(bars, 59, "XAUUSD", { assetConfirm: false, targetWalk: true });
    assert.equal(off.action, forcedOff.action);
    assert.equal(off.reason, forcedOff.reason);
    assert.notEqual(off.reason, "ASSET_CONFIRM");
  });
});
