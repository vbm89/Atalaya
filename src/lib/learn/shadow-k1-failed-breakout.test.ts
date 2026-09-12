import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildK1Report, K1_REGISTERED_AT, scanK1FailedBreakout, type K1Bar } from "./shadow-k1-failed-breakout.ts";

function bar(t: number, o: number, h: number, l: number, c: number, assetId = "XAUUSD"): K1Bar {
  return { assetId, t, o, h, l, c };
}

function fixture(start = 0, assetId = "XAUUSD"): K1Bar[] {
  const rows: K1Bar[] = [];
  for (let i = 0; i < 20; i += 1) rows.push(bar(start + i * 900, 100, 101, 99, 100, assetId));
  rows.push(bar(start + 20 * 900, 100, 101.4, 100, 101.3, assetId));
  rows.push(bar(start + 21 * 900, 101.3, 101.2, 100.8, 100.5, assetId));
  rows.push(bar(start + 22 * 900, 100.5, 100.7, 97.8, 98, assetId));
  return rows;
}

function fixtureWithRepeatedBreakout(start = 0): K1Bar[] {
  const rows = fixture(start);
  rows[21] = bar(start + 21 * 900, 101.3, 101.6, 101.1, 101.3);
  rows[22] = bar(start + 22 * 900, 101.3, 101.2, 100.8, 100.5);
  rows[23] = bar(start + 23 * 900, 100.5, 100.7, 97.8, 98);
  return rows;
}

function fixtureWithTouchCtDivergence(start = 0): K1Bar[] {
  const rows = fixture(start);
  // Candidate is a sell with SL 101.6 and TP1 90.8. First post-decision bar
  // wicks through SL but closes below it; CT has not stopped yet.
  rows.push(bar(start + 23 * 900, 98, 101.7, 97.5, 98));
  // CT reaches TP1 by close; Touch was already stopped on the prior wick.
  rows.push(bar(start + 24 * 900, 98, 99, 90.7, 90.7));
  return rows;
}

describe("K1 failed breakout / trap", () => {
  it("detects a failed upside breakout only after the reclaim closes", () => {
    const candidates = scanK1FailedBreakout(fixture());
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.direction, "sell");
    assert.equal(candidates[0]!.decisionSlot, 22 * 900 + 900);
    assert.equal(candidates[0]!.breakoutSlot, 20 * 900 + 900);
    assert.equal(candidates[0]!.tp1 < candidates[0]!.entry, true);
  });

  it("consumes repeated breakout candles as one causal breakout event", () => {
    const candidates = scanK1FailedBreakout(fixtureWithRepeatedBreakout());
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.breakoutSlot, 20 * 900 + 900);
    assert.equal(candidates[0]!.decisionSlot, 23 * 900 + 900);
  });

  it("starts outcome after the decision candle and keeps costs unknown", () => {
    const report = buildK1Report({ XAUUSD: fixture() });
    assert.equal(report.candidates, 1);
    assert.equal(report.uniqueBreakoutEvents, 1);
    assert.equal(report.decided, 1);
    assert.equal(report.tp1, 1);
    assert.equal(report.sl, 0);
    assert.equal(report.pending, 0);
    assert.equal(report.expired, 0);
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

  it("exposes Touch vs Close-through discordance without selecting a winner", () => {
    const report = buildK1Report({ XAUUSD: fixtureWithTouchCtDivergence() });
    assert.equal(report.candidates, 1);
    assert.equal(report.fillModels.touchDecided, 1);
    assert.equal(report.fillModels.closeThroughDecided, 1);
    assert.equal(report.fillModels.touchExpectancyR, -1);
    assert.equal(report.fillModels.closeThroughExpectancyR, 2);
    assert.equal(report.fillModels.discordantCount, 1);
    assert.equal(report.fillModels.agreeSameFirstTouch, 0);
    assert.equal(report.fillModels.touchSl_ctTp1, 1);
  });

  it("marks an outcome at the right edge as pending, not expired", () => {
    const rows = fixture();
    const report = buildK1Report({ XAUUSD: rows });
    assert.equal(report.pending, 0);
    const edge = rows.slice(0, -1);
    // Reuse a candidate whose decision is now the final available bar by
    // constructing the same setup and dropping all post-decision bars.
    const reportAtEdge = buildK1Report({ XAUUSD: edge });
    assert.equal(reportAtEdge.expired, 0);
    assert.equal(reportAtEdge.pending, 1);
    assert.equal(reportAtEdge.decided, 0);
  });

  it("uses the fixed registration timestamp for the cohort and never a moving 80/20 cut", () => {
    assert.equal(K1_REGISTERED_AT, Math.floor(Date.parse("2026-09-12T06:30:00Z") / 1000));
    const before = fixture(K1_REGISTERED_AT - 30_000);
    const after = fixture(K1_REGISTERED_AT + 30_000);
    const report = buildK1Report({ XAUUSD: before });
    assert.equal(report.train.n, 1);
    assert.equal(report.test.hidden, true);
    const afterReport = buildK1Report({ XAUUSD: after });
    assert.equal(afterReport.train.n, 0);
    assert.equal(afterReport.test.hidden, true);
    assert.equal(afterReport.test.n, 1);
  });
});
