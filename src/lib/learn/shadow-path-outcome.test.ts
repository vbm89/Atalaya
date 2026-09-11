import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowPathOutcome } from "./shadow-path-outcome";

const baseCase = {
  episodeId: "ep-1",
  direction: "buy",
  entry: 100,
  sl: 99,
  tp1: 101,
  tp2: 102,
  closedAtMs: null,
} as any;

const candidate = {
  episodeId: "ep-1",
  variant: "BREAKOUT_RETEST",
  decisionSlot: 1000,
  decisionBarTime: 100,
  trigger: "breakout_retest",
  triggerVolumeRatio: null,
  triggerVolumeAvailable: false,
  features: {} as any,
  outcome: "pending",
  firstTouchAtSec: null,
  rrAtOutcome: null,
  dataComplete: false,
  mfe: null,
  mae: null,
  mfeR: null,
  maeR: null,
} as any;

function bar(t: number, o: number, h: number, l: number, c: number) {
  return { episodeId: "ep-1", tf: "15m", t, o, h, l, c, v: null, role: "forward" } as any;
}

test("path excludes the decision candle and preserves TP1 before later SL", () => {
  const result = buildShadowPathOutcome(candidate, {
    case: baseCase,
    events: [],
    bars: [
      bar(100, 100, 102, 100, 101),
      bar(1000, 100, 101.2, 99.8, 100.5),
      bar(1900, 100.5, 100.7, 98.8, 99),
    ],
  });

  assert.equal(result.reachedTp1, true);
  assert.equal(result.reachedTp2, false);
  assert.equal(result.firstTouch, "tp1");
  assert.equal(result.terminal, "sl");
  assert.equal(result.timeToTp1Sec, 0);
  assert.equal(result.timeToSlSec, 900);
  assert.ok(Math.abs((result.mfeBeforeSl ?? 0) - 1.2) < 1e-9);
});

test("same-bar SL and TP1 is conservatively SL and explicitly ambiguous", () => {
  const result = buildShadowPathOutcome(candidate, {
    case: baseCase,
    events: [],
    bars: [bar(1000, 100, 101.2, 98.8, 100)],
  });

  assert.equal(result.reachedTp1, true);
  assert.equal(result.firstTouch, "tp1");
  assert.equal(result.terminal, "sl");
  assert.equal(result.sameBarAmbiguous, true);
  assert.equal(result.mfeBeforeSl, 0);
});

test("TP2 records TP1 path information and terminates at TP2", () => {
  const result = buildShadowPathOutcome(candidate, {
    case: baseCase,
    events: [],
    bars: [bar(1000, 100, 102.2, 99.8, 102)],
  });

  assert.equal(result.reachedTp1, true);
  assert.equal(result.reachedTp2, true);
  assert.equal(result.firstTouch, "tp1");
  assert.equal(result.terminal, "tp2");
  assert.equal(result.timeToTp1Sec, 0);
});
