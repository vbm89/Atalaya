import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildK1Report, scanK1FailedBreakout, type K1Bar } from "./shadow-k1-failed-breakout.ts";

function bar(t: number, o: number, h: number, l: number, c: number): K1Bar {
  return { assetId: "XAUUSD", t, o, h, l, c };
}

function fixture(): K1Bar[] {
  const rows: K1Bar[] = [];
  for (let i = 0; i < 20; i += 1) rows.push(bar(i * 900, 100, 101, 99, 100));
  rows.push(bar(20 * 900, 100, 101.4, 100, 101.3));
  rows.push(bar(21 * 900, 101.3, 101.2, 100.8, 100.5));
  rows.push(bar(22 * 900, 100.5, 100.7, 97.8, 98));
  rows.push(bar(23 * 900, 98, 99, 97.5, 98.2));
  return rows;
}

describe("K1 failed breakout / trap", () => {
  it("detects a failed upside breakout only after the reclaim closes", () => {
    const candidates = scanK1FailedBreakout(fixture());
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.direction, "sell");
    assert.equal(candidates[0]!.decisionSlot, 21 * 900 + 900);
    assert.equal(candidates[0]!.tp1 < candidates[0]!.entry, true);
  });

  it("starts outcome after the decision candle and keeps costs unknown", () => {
    const report = buildK1Report({ XAUUSD: fixture() });
    assert.equal(report.candidates, 1);
    assert.equal(report.decided, 1);
    assert.equal(report.tp1, 1);
    assert.equal(report.sl, 0);
    assert.equal(report.successPct, 100);
    assert.equal(report.netExpectancyR, null);
    assert.equal(report.costsKnown, false);
    assert.equal(report.path.reachedTp1, 1);
    assert.equal(report.path.ambiguous, 0);
    assert.equal(report.fillModels.touchDecided, 1);
    assert.equal(report.fillModels.closeThroughDecided, 0);
    assert.equal(report.fillModels.touchExpectancyR, 2);
    assert.equal(report.fillModels.closeThroughExpectancyR, null);
  });
});
