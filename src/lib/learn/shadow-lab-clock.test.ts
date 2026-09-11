import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decisionCutMs, isTrainDecision, SHADOW_TRAIN_CUT_BASIS } from "./shadow-lab-clock.ts";
import { buildShadowReplayReport, slotToMs } from "./shadow-replay.ts";
import type { ShadowEpisode, ShadowTapeBar } from "./shadow-replay.ts";
import type { ShadowCaseInput } from "./shadow-features.ts";

function baseCase(id: string, openedSlot: number): ShadowCaseInput {
  return {
    episodeId: id,
    assetId: "XAUUSD",
    direction: "sell",
    kind: "continuation",
    openedAtMs: 1_000,
    openedSlot,
    openedState: "pending",
    currentState: "wait",
    closedAtMs: 20_000_000,
    bias4hLabel: "BAJISTA LOCAL",
    qualityPhase: "preliminar",
    volumeRatio15: 1.2,
    volumeAvailable15: true,
    volumeRatio4h: 1.1,
    volumeAvailable4h: true,
    highImpact: false,
    underlyingClosed: false,
    dataStatus: "ok",
    zoneLow: 100,
    zoneHigh: 110,
    entry: 100,
    sl: 115,
    tp1: 80,
    tp2: 70,
    invalidation: 120,
    riskReward: 1.333,
    quality: "media",
    slWide: false,
  };
}

function bar(id: string, t: number, o: number, h: number, l: number, c: number): ShadowTapeBar {
  return { episodeId: id, tf: "15m", t, o, h, l, c, v: 2, role: "forward" };
}

function volume(id: string, start: number): ShadowTapeBar[] {
  return Array.from({ length: 8 }, (_, i) => bar(id, start + i * 900, 105, 106, 104, 105));
}

describe("decision clock split", () => {
  it("uses decisionSlot basis, not MAP birth", () => {
    assert.equal(SHADOW_TRAIN_CUT_BASIS, "decisionSlot");
    const times = [1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000];
    const cut = decisionCutMs(times, 0.7);
    assert.equal(cut, 7_000);
    assert.equal(isTrainDecision(6, 7000), true);
    assert.equal(isTrainDecision(8, 7000), false);
  });

  it("a late decision on an early MAP is TEST, not TRAIN", () => {
    const episodes: ShadowEpisode[] = [];
    for (let i = 0; i < 10; i += 1) {
      const id = `XAUUSD-clock-${i}`;
      const openedSlot = 1_000;
      const triggerT = 10_000 + i * 86_400;
      const lookback = volume(id, triggerT - 8 * 900);
      const trigger = bar(id, triggerT, 106, 110, 100, 102);
      const later = bar(id, triggerT + 900, 102, 103, 79, 80);
      episodes.push({
        case: { ...baseCase(id, openedSlot), openedAtMs: 1_000 },
        events: [],
        bars: [...lookback, trigger, later],
        observedOutcome: null,
      });
    }
    const report = buildShadowReplayReport(episodes);
    assert.equal(report.trainCutBasis, "decisionSlot");
    const volumeRelaxed = report.variants.find((v) => v.variant === "VOLUME_RELAXED");
    assert.ok(volumeRelaxed);
    assert.ok(volumeRelaxed!.test.n > 0);
    assert.equal(volumeRelaxed!.train.n + volumeRelaxed!.test.n, volumeRelaxed!.candidates);
    assert.ok(report.trainCutMs > 1_000);
  });
});
