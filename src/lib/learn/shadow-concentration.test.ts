import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concentrationVeto, expectancyR } from "./shadow-concentration.ts";
import { evaluateFrequencyPromotion } from "./shadow-frequency.ts";

describe("concentration veto", () => {
  it("flips sign when the best trade carries the expectancy", () => {
    const day = Math.floor(Date.parse("2026-09-10T10:00:00Z") / 1000);
    const rows = [
      { decisionSlot: day, outcome: "tp2" as const, rrAtOutcome: 3 },
      { decisionSlot: day + 900, outcome: "sl" as const, rrAtOutcome: -1 },
      { decisionSlot: day + 1800, outcome: "sl" as const, rrAtOutcome: -1 },
    ];
    assert.ok((expectancyR(rows) ?? 0) > 0);
    const v = concentrationVeto(rows);
    assert.equal(v.veto, true);
    assert.equal(v.bestTradeFlipsSign, true);
    assert.ok((v.withoutBestTradeR ?? 0) <= 0);
  });

  it("flips sign when one day carries the expectancy", () => {
    const a = Math.floor(Date.parse("2026-09-01T10:00:00Z") / 1000);
    const b = Math.floor(Date.parse("2026-09-08T10:00:00Z") / 1000);
    const rows = [
      { decisionSlot: a, outcome: "tp1" as const, rrAtOutcome: 4 },
      { decisionSlot: a + 900, outcome: "tp1" as const, rrAtOutcome: 2 },
      { decisionSlot: b, outcome: "sl" as const, rrAtOutcome: -1 },
      { decisionSlot: b + 900, outcome: "sl" as const, rrAtOutcome: -1 },
    ];
    const v = concentrationVeto(rows);
    assert.equal(v.bestDayFlipsSign, true);
    assert.equal(v.veto, true);
  });

  it("blocks KEEP_RESEARCH when concentration veto fires", () => {
    const promo = evaluateFrequencyPromotion({
      extraTestN: 40,
      trainExpectancyR: 0.4,
      testExpectancyR: 0.3,
      opportunitiesPerDay: 4,
      assetSuccessRangePp: 5,
      sessionSuccessRangePp: 5,
      assetCoverage: 4,
      sessionCoverage: 3,
      concentrationVeto: true,
      concentrationReason: "el mejor trade invierte el signo de R",
    });
    assert.equal(promo.status, "DISCARD");
    assert.equal(promo.live, false);
    assert.equal(promo.noLookahead, "demonstrated_by_tests");
  });
});
