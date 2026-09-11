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
  it("starts at 0 and does not count replay rows or legacy variants", () => {
    assert.equal(kHypotheses(), 0);
    assert.equal(SHADOW_HYPOTHESIS_REGISTRY.length, 0);
    assert.equal(SHADOW_PREREGISTER_PLAN.kCountsReplayRows, false);
    assert.equal(SHADOW_PREREGISTER_PLAN.testIsJudgeNotLeaderboard, true);
    assert.ok(SHADOW_VARIANTS.length >= 10);
    assert.ok(isLegacyUnregistered("VOLUME_RELAXED"));
    assert.equal(hypothesisTestVisible("VOLUME_RELAXED"), false);
  });

  it("k increments only when a REGISTERED or SEALED hypothesis is added", () => {
    const one: ShadowHypothesis = {
      id: "demo",
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
    assert.equal(kHypotheses(), 0);
  });
});
