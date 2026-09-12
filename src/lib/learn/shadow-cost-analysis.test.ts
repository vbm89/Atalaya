import { describe, expect, it } from "vitest";
import { analyzeShadowCosts } from "./shadow-cost-analysis";
import type { ShadowCandidateResult, ShadowEpisode } from "./shadow-replay";

function episode(): ShadowEpisode {
  return {
    case: {
      episodeId: "e1",
      assetId: "BTCUSD",
      direction: "buy",
      zoneLow: 99,
      zoneHigh: 100,
      entry: 100,
      sl: 98,
      tp1: 104,
      tp2: 106,
      openedSlot: 1000,
      openedState: "entry",
      dataStatus: "ok",
      highImpact: false,
      underlyingClosed: false,
      invalidation: 98,
      closedAtMs: 9999999999,
    } as ShadowEpisode["case"],
    events: [],
    bars: [
      { episodeId: "e1", tf: "15m", t: 1000, o: 100, h: 101, l: 99, c: 100.5, v: 10, role: "forward" },
      { episodeId: "e1", tf: "15m", t: 1900, o: 100.5, h: 105, l: 100, c: 104, v: 10, role: "forward" },
    ],
  };
}

function row(): ShadowCandidateResult {
  return {
    episodeId: "e1",
    variant: "VOLUME_RELAXED",
    decisionSlot: 1000,
    decisionBarTime: 1000,
    trigger: "retest",
    triggerVolumeRatio: null,
    triggerVolumeAvailable: false,
    features: {} as ShadowCandidateResult["features"],
    outcome: "tp1",
    firstTouchAtSec: 1900,
    rrAtOutcome: 2,
    dataComplete: true,
    mfe: 5,
    mae: 1,
    mfeR: 2.5,
    maeR: 0.5,
  };
}

describe("analyzeShadowCosts", () => {
  it("keeps costs unknown when no asset execution data exists", () => {
    const report = analyzeShadowCosts([episode()], [row()]);
    const scenario = report.variants.find((v) => v.variant === "VOLUME_RELAXED")!.scenarios[0]!;
    expect(scenario.costUnknown).toBe(true);
    expect(scenario.netExpectancyR).toBeNull();
    expect(report.costsKnown).toBe(false);
  });

  it("computes fixed net costs when execution data is explicitly configured", () => {
    const report = analyzeShadowCosts([episode()], [row()], {
      assets: [{ assetId: "BTCUSD", spreadPrice: 0.2, commissionPrice: 0.1, riskPrice: 2 }],
      slippageSpreads: [0.5],
    });
    const scenario = report.variants.find((v) => v.variant === "VOLUME_RELAXED")!.scenarios[0]!;
    expect(scenario.known).toBe(true);
    expect(scenario.grossExpectancyR).toBe(2);
    expect(scenario.netExpectancyR).toBeCloseTo(1.825);
  });

  it("does not treat a wick-only TP as close-through", () => {
    const ep = episode();
    ep.bars = ep.bars.map((b, i) => i === 1 ? { ...b, c: 103, h: 105 } : b);
    const report = analyzeShadowCosts([ep], [row()], {
      assets: [{ assetId: "BTCUSD", spreadPrice: 0.2, commissionPrice: 0.1, riskPrice: 2 }],
      slippageSpreads: [0],
    });
    const scenario = report.variants.find((v) => v.variant === "VOLUME_RELAXED")!.scenarios.find((s) => s.fillModel === "close_through")!;
    expect(scenario.decided).toBe(0);
    expect(scenario.netExpectancyR).toBeNull();
  });
});
