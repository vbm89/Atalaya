import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateShadowPromotion } from "./shadow-promotion-gate.ts";

const ready = {
  extraTestDecided: 80,
  candidateDays: 40,
  assetsWithEvidence: 2,
  positiveNetExpectancyTrain: true,
  positiveNetExpectancyTest: true,
  positiveMedianR: true,
  touchAndCloseThroughSameSign: true,
  walkForwardWindows: 3,
  walkForwardStable: true,
  bestTradeStable: true,
  bestDayStable: true,
  top3PnlShare: 0.39,
  parameterNeighborsSameSignPct: 70,
  multipleTestingAdjusted: true,
  costsKnown: true,
};

describe("evaluateShadowPromotion", () => {
  it("stays locked when any robustness gate fails", () => {
    const result = evaluateShadowPromotion({ ...ready, extraTestDecided: 79 });
    assert.equal(result.eligible, false);
    assert.equal(result.status, "NOT_READY");
    assert.ok(result.reasons.includes("EXTRA TEST < 80"));
  });

  it("does not allow concentration at exactly 40%", () => {
    const result = evaluateShadowPromotion({ ...ready, top3PnlShare: 0.4 });
    assert.equal(result.eligible, false);
  });

  it("requires known costs and independent multiple-testing control", () => {
    const result = evaluateShadowPromotion({ ...ready, costsKnown: false, multipleTestingAdjusted: false });
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("costes desconocidos"));
    assert.ok(result.reasons.includes("múltiples pruebas sin ajuste"));
  });

  it("keeps the gate research-only even when all criteria are met", () => {
    const result = evaluateShadowPromotion(ready);
    assert.equal(result.eligible, true);
    assert.equal(result.status, "RESEARCH");
  });
});
