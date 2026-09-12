import { describe, expect, it } from "vitest";
import { evaluateShadowPromotion } from "./shadow-promotion-gate";

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
    expect(result.eligible).toBe(false);
    expect(result.status).toBe("NOT_READY");
    expect(result.reasons).toContain("EXTRA TEST < 80");
  });

  it("does not allow concentration at exactly 40%", () => {
    const result = evaluateShadowPromotion({ ...ready, top3PnlShare: 0.4 });
    expect(result.eligible).toBe(false);
  });

  it("requires known costs and independent multiple-testing control", () => {
    const result = evaluateShadowPromotion({ ...ready, costsKnown: false, multipleTestingAdjusted: false });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(["costes desconocidos", "múltiples pruebas sin ajuste"]));
  });

  it("keeps the gate research-only even when all criteria are met", () => {
    const result = evaluateShadowPromotion(ready);
    expect(result.eligible).toBe(true);
    expect(result.status).toBe("RESEARCH");
  });
});
