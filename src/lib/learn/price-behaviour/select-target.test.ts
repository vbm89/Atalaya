import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessRisk, selectTarget } from "./decide.ts";
import { PARAMS } from "./params.ts";
import type { StructureView, Swing } from "./types.ts";

function swing(price: number, kind: Swing["kind"]): Swing {
  return { index: 10, price, kind, confirmIndex: 12 };
}

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

describe("selectTarget", () => {
  it("uses the nearest structural level when it already pays 1.5", () => {
    const entry = 100;
    const atr = 1;
    const defended = 99;
    const view = structure({
      lastHigh: swing(102, "high"),
      recentHigh: 104,
    });
    const target = selectTarget("LONG", entry, view, null, null, atr, defended);
    assert.equal(target?.price, 102);
    assert.equal(target?.source, "swing_high");
    const risk = assessRisk({
      direction: "LONG",
      entry,
      defended,
      atr,
      target: target!.price,
      targetSource: target!.source,
    });
    assert.equal(risk.ok, true);
    assert.ok((risk.rr ?? 0) >= PARAMS.minRr);
    assert.equal(risk.stop, defended - PARAMS.atrBufferFrac * atr);
  });

  it("skips a close level and keeps the next existing one that pays 1.5", () => {
    const entry = 100;
    const atr = 1;
    const defended = 99.2;
    const view = structure({
      lastHigh: swing(100.4, "high"),
      recentHigh: 103,
      rangeHigh: 101,
    });
    const nearest = 100.4;
    const nearRisk = assessRisk({
      direction: "LONG",
      entry,
      defended,
      atr,
      target: nearest,
      targetSource: "swing_high",
    });
    assert.equal(nearRisk.ok, false);
    assert.equal(nearRisk.reason, "RR_INSUFFICIENT");
    const target = selectTarget("LONG", entry, view, null, null, atr, defended);
    assert.equal(target?.price, 103);
    assert.equal(target?.source, "recent_high");
    const risk = assessRisk({
      direction: "LONG",
      entry,
      defended,
      atr,
      target: target!.price,
      targetSource: target!.source,
    });
    assert.equal(risk.ok, true);
    assert.equal(risk.stop, nearRisk.stop);
    assert.ok((risk.rr ?? 0) >= PARAMS.minRr);
  });

  it("keeps the nearest level when no existing level pays 1.5", () => {
    const view = structure({
      lastHigh: swing(100.3, "high"),
      recentHigh: 100.5,
    });
    const target = selectTarget("LONG", 100, view, null, null, 1, 99.2);
    assert.equal(target?.price, 100.3);
    assert.notEqual(target?.source, "ATR_FALLBACK");
  });

  it("falls back to ATR only when the direction has no structural level", () => {
    const target = selectTarget("SHORT", 100, structure({}), null, null, 2, 101);
    assert.equal(target?.source, "ATR_FALLBACK");
    assert.equal(target?.price, 96);
  });
});
