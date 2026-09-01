import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "../trading/types.ts";
import { OUTCOME_RULE, resolveOutcome } from "./outcome.ts";

function bar(time: number, o: number, h: number, l: number, c: number): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: 1 };
}

const sellBase = {
  direction: "sell" as const,
  sl: 100,
  tp1: 80,
  tp2: 70,
  zoneLow: 88,
  zoneHigh: 90,
  openedSlot: 1_000,
};

describe("desenlace M15 wick", () => {
  it("uses the documented rule id", () => {
    assert.equal(OUTCOME_RULE, "m15-wick-first-touch-sl-wins-same-bar");
  });

  it("ignores the decision bar and stays pending without later touch", () => {
    const r = resolveOutcome({
      ...sellBase,
      closed: false,
      candles: [bar(100, 90, 91, 89, 90)],
    });
    assert.equal(r.outcome, "pending");
    assert.equal(r.firstTouch, null);
  });

  it("SL wick after the slot", () => {
    const r = resolveOutcome({
      ...sellBase,
      closed: false,
      candles: [bar(1_000, 90, 101, 89, 95)],
    });
    assert.equal(r.outcome, "sl");
    assert.equal(r.firstTouchAtSec, 1_000);
  });

  it("TP1 wick after the slot", () => {
    const r = resolveOutcome({
      ...sellBase,
      closed: false,
      candles: [bar(1_000, 90, 91, 79, 85)],
    });
    assert.equal(r.outcome, "tp1");
  });

  it("same bar SL and TP1 → SL (conservative)", () => {
    const r = resolveOutcome({
      ...sellBase,
      closed: false,
      candles: [bar(1_000, 90, 101, 79, 85)],
    });
    assert.equal(r.outcome, "sl");
  });

  it("closed without touch → expired, not a fake win", () => {
    const r = resolveOutcome({
      ...sellBase,
      closed: true,
      candles: [bar(1_000, 90, 91, 89, 90)],
    });
    assert.equal(r.outcome, "expired");
  });

  it("buy TP1 by high", () => {
    const r = resolveOutcome({
      direction: "buy",
      sl: 80,
      tp1: 100,
      tp2: 110,
      zoneLow: 90,
      zoneHigh: 92,
      openedSlot: 50,
      closed: false,
      candles: [bar(50, 91, 101, 90, 99)],
    });
    assert.equal(r.outcome, "tp1");
  });
});
