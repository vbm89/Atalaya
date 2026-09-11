import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanBreakoutRetest } from "./shadow-independent.ts";

function bar(t: number, o: number, h: number, l: number, c: number) {
  return { t, o, h, l, c, v: 100 };
}

describe("independent 15M breakout-retest", () => {
  it("emits only after a later closed retest", () => {
    const bars = Array.from({ length: 17 }, (_, i) => bar(i * 900, 100, 101, 99, 100));
    bars.push(bar(17 * 900, 100, 103, 100, 102));
    bars.push(bar(18 * 900, 102, 103, 100.5, 101.5));
    const rows = scanBreakoutRetest("US100", bars);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.strategy, "BREAKOUT_RETEST_15M");
    assert.equal(rows[0]?.direction, "buy");
    assert.equal(rows[0]?.decisionSlot, 19 * 900);
  });

  it("does not emit from future candles before the retest exists", () => {
    const bars = Array.from({ length: 16 }, (_, i) => bar(i * 900, 100, 101, 99, 100));
    bars.push(bar(16 * 900, 100, 103, 100, 102));
    assert.equal(scanBreakoutRetest("BTCUSD", bars).length, 0);
  });
});
