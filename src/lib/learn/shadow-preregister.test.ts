import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHADOW_HYPOTHESIS_REGISTRY,
  SHADOW_PREREGISTER_PLAN,
  hypothesisTestVisible,
  isLegacyUnregistered,
  kHypotheses,
  type ShadowHypothesis,
} from "./shadow-preregister.ts";
import { SHADOW_VARIANTS, replayCandidates } from "./shadow-replay.ts";
import { analyzeShadowReplay } from "./shadow-analysis.ts";

describe("pre-registration k", () => {
  it("has exactly one registered hypothesis and does not count legacy variants", () => {
    assert.equal(kHypotheses(), 1);
    assert.equal(SHADOW_HYPOTHESIS_REGISTRY.length, 1);
    assert.equal(SHADOW_HYPOTHESIS_REGISTRY[0]!.id, "K1_FAILED_BREAKOUT_TRAP_15M");
    assert.equal(SHADOW_HYPOTHESIS_REGISTRY[0]!.status, "REGISTERED");
    assert.equal(SHADOW_PREREGISTER_PLAN.kCountsReplayRows, false);
    assert.equal(SHADOW_PREREGISTER_PLAN.testIsJudgeNotLeaderboard, true);
    assert.ok(SHADOW_VARIANTS.length >= 10);
    assert.ok(isLegacyUnregistered("VOLUME_RELAXED"));
    assert.equal(hypothesisTestVisible("VOLUME_RELAXED"), false);
    assert.equal(hypothesisTestVisible("K1_FAILED_BREAKOUT_TRAP_15M"), false);
  });

  it("freezes the K1 parameters before TEST", () => {
    const k1 = SHADOW_HYPOTHESIS_REGISTRY[0]!;
    assert.equal(k1.universe, "independent_tape");
    assert.equal(k1.assets, "all");
    assert.equal(k1.parameters.timeframe, "15m");
    assert.equal(k1.parameters.rangeLookbackBars, 16);
    assert.equal(k1.parameters.atrPeriodBars, 14);
    assert.equal(k1.parameters.breakoutCloseAtr, 0.1);
    assert.equal(k1.parameters.maxFailureBars, 4);
    assert.equal(k1.parameters.tp1R, 2);
    assert.equal(k1.parameters.volumeFilter, false);
    assert.equal(k1.parameters.sessionFilter, false);
    assert.equal(k1.parameters.newsFilter, false);
    assert.equal(k1.parameters.unknownCostsBlockPromotion, true);
    assert.equal(k1.version, 1);
    assert.equal(SHADOW_PREREGISTER_PLAN.sealInspectsTestOutcomes, false);
    assert.equal(SHADOW_PREREGISTER_PLAN.geometryChangeIsNewHypothesis, true);
  });

  it("k increments only when a REGISTERED or SEALED hypothesis is added", () => {
    const one: ShadowHypothesis = {
      id: "demo",
      version: 1,
      label: "demo",
      geometry: "breakout_retest",
      parameters: { lookback: 16 },
      universe: "independent_tape",
      assets: "all",
      primaryMetric: "extra_test_net_expectancy_r",
      registeredAt: "2026-09-11T00:00:00Z",
      status: "REGISTERED",
    };
    const legacy: ShadowHypothesis = { ...one, id: "legacy", status: "LEGACY_NOT_PREREGISTERED" };
    const sealed: ShadowHypothesis = { ...one, id: "sealed", status: "SEALED" };
    assert.equal(kHypotheses([legacy]), 0);
    assert.equal(kHypotheses([one]), 1);
    assert.equal(kHypotheses([one, sealed, legacy]), 2);
    assert.equal(hypothesisTestVisible("demo", [one]), false);
    assert.equal(hypothesisTestVisible("sealed", [sealed]), true);
  });

  it("running replay does not change k", () => {
    const before = kHypotheses();
    replayCandidates([]);
    analyzeShadowReplay([]);
    assert.equal(kHypotheses(), before);
    assert.equal(kHypotheses(), 1);
  });
});
