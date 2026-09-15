import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditOrderBlocks } from "./shadow-ob-audit.ts";
import { atrAt } from "./shadow-discovery-primitives.ts";
import type { DiscoveryBar } from "./shadow-discovery-types.ts";

function bar(t: number, o: number, h: number, l: number, c: number): DiscoveryBar {
  return { assetId: "BTCUSD", tf: "15m", t, o, h, l, c, v: 10, source: "test" };
}

function series(): DiscoveryBar[] {
  const out: DiscoveryBar[] = [];
  let px = 100;
  for (let i = 0; i < 15; i += 1) {
    const o = px;
    const c = px + 0.2;
    out.push(bar(i * 900, o, Math.max(o, c) + 0.4, Math.min(o, c) - 0.4, c));
    px = c;
  }
  return out;
}

describe("order block descriptive audit", () => {
  it("reports the first closed-bar touch only after the OB decision", () => {
    const bars = series();
    const i = bars.length - 1;
    const atr = atrAt(bars, i)!;
    bars[i - 1] = { ...bars[i - 1]!, o: 101, c: 99.5, h: 101.2, l: 99 };
    bars[i] = { ...bars[i]!, o: 100, c: 100 + atr * 1.5, h: 100 + atr * 1.6, l: 99.9 };
    const report = auditOrderBlocks(bars);
    assert.equal(report.status, "DESCRIPTIVE_ONLY");
    assert.equal(report.detected, 1);
    assert.equal(report.touchedWithinHorizon, 0);

    const future = bar(bars[i]!.t + 900, 100.5, 101, 99.5, 100.7);
    const touched = auditOrderBlocks([...bars, future]);
    assert.equal(touched.detected, 1);
    assert.equal(touched.rows[0]!.firstTouchT, future.t);
    assert.equal(touched.rows[0]!.barsToFirstTouch, 1);
  });

  it("does not use bars before the decision as a touch", () => {
    const bars = series();
    const i = bars.length - 1;
    const atr = atrAt(bars, i)!;
    bars[i - 1] = { ...bars[i - 1]!, o: 101, c: 99.5, h: 101.2, l: 99 };
    bars[i] = { ...bars[i]!, o: 100, c: 100 + atr * 1.5, h: 100 + atr * 1.6, l: 99.9 };
    const report = auditOrderBlocks(bars);
    assert.equal(report.rows[0]!.firstTouchT, null);
    assert.equal(report.rows[0]!.barsToFirstTouch, null);
  });

  it("keeps an empty sample as UNKNOWN rate, not zero", () => {
    const report = auditOrderBlocks(series().slice(0, 1));
    assert.equal(report.detected, 0);
    assert.equal(report.touchRate, null);
  });
});
