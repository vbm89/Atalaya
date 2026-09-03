import assert from "node:assert/strict";
import test from "node:test";
import type { ShadowCaseInput } from "./shadow-features";
import {
  buildShadowReplayReport,
  shadowCandidateForTest,
  shadowOutcomeForTest,
  type ShadowEpisode,
  type ShadowTapeBar,
} from "./shadow-replay";

function baseCase(id = "XAUUSD-1000-test"): ShadowCaseInput {
  return {
    episodeId: id,
    assetId: "XAUUSD",
    direction: "sell",
    kind: "continuation",
    openedAtMs: 1_000_000,
    openedSlot: 1000,
    openedState: "map",
    currentState: "wait",
    closedAtMs: 6_000_000,
    bias4hLabel: "BAJISTA LOCAL",
    qualityPhase: "preliminar",
    volumeRatio15: null,
    volumeAvailable15: null,
    volumeRatio4h: null,
    volumeAvailable4h: null,
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

function bar(episodeId: string, t: number, o: number, h: number, l: number, c: number, v: number | null = null): ShadowTapeBar {
  return { episodeId, tf: "15m", t, o, h, l, c, v, role: "forward" };
}

function episode(id: string, triggerBar: ShadowTapeBar, outcomeBar: ShadowTapeBar, events: ShadowEpisode["events"] = []): ShadowEpisode {
  return {
    case: { ...baseCase(id), episodeId: id },
    events,
    bars: [
      bar(id, 100, 100, 101, 99, 100, 100),
      bar(id, 1000, 100, 101, 99, 100, null),
      bar(id, 1900, 100, 101, 94, 95, null),
      triggerBar,
      outcomeBar,
    ],
    observedOutcome: null,
  };
}

test("candidate generation is outcome-blind", () => {
  const id = "XAUUSD-1000-blind";
  const trigger = bar(id, 2800, 108, 109, 100, 108, null);
  const e1 = episode(id, trigger, bar(id, 3700, 109, 116, 108, 115));
  const e2 = { ...e1, observedOutcome: "tp1" };
  const a = shadowCandidateForTest(e1, "TRIGGER_RELAXED");
  const b = shadowCandidateForTest(e2, "TRIGGER_RELAXED");
  assert.deepEqual(a, b);
});

test("volume-relaxed accepts a trigger with unavailable volume while baseline does not invent an entry", () => {
  const id = "XAUUSD-1000-volume";
  const trigger = bar(id, 2800, 106, 110, 100, 102, null);
  const e = episode(id, trigger, bar(id, 3700, 102, 103, 79, 80));
  const events: ShadowEpisode["events"] = [];
  const baseline = shadowCandidateForTest(e, "BASELINE_V1");
  const relaxed = shadowCandidateForTest(e, "VOLUME_RELAXED");
  assert.equal(baseline, null);
  assert.equal(relaxed?.trigger, "reject");
  assert.equal(relaxed?.triggerVolumeAvailable, false);
  assert.equal(relaxed?.decisionSlot, 3700);
  assert.equal(events.length, 0);
});

test("trigger-relaxed accepts a retest that is not fail-accept/reject", () => {
  const id = "XAUUSD-1000-trigger";
  const trigger = bar(id, 2800, 107, 110, 100, 108, 2);
  const e = episode(id, trigger, bar(id, 3700, 108, 109, 79, 80));
  const candidate = shadowCandidateForTest(e, "TRIGGER_RELAXED");
  assert.equal(candidate?.trigger, "retest");
  assert.equal(candidate?.decisionSlot, 3700);
});

test("outcome is evaluated only after the candidate decision slot and SL wins same bar", () => {
  const id = "XAUUSD-1000-outcome";
  const trigger = bar(id, 2800, 106, 110, 100, 102, 2);
  const e = episode(id, trigger, bar(id, 3700, 108, 116, 79, 80));
  const candidate = shadowCandidateForTest(e, "TRIGGER_RELAXED");
  assert.ok(candidate);
  const result = shadowOutcomeForTest(candidate, e);
  assert.equal(result.outcome, "sl");
  assert.equal(result.firstTouchAtSec, 3700);
});

test("MAPA -> PENDING -> ENTRADA remains observed-only for baseline", () => {
  const id = "XAUUSD-1000-states";
  const trigger = bar(id, 2800, 106, 110, 100, 102, 2);
  const e = episode(id, trigger, bar(id, 3700, 102, 103, 79, 80), [
    { episodeId: id, fromState: "map", toState: "pending", atMs: 3_700_000, slot: 3700 },
    { episodeId: id, fromState: "pending", toState: "entry", atMs: 4_600_000, slot: 4600 },
  ]);
  const baseline = shadowCandidateForTest(e, "BASELINE_V1");
  assert.equal(baseline?.decisionSlot, 4600);
});

test("missing volume and gaps are represented without fabricating bars", () => {
  const id = "XAUUSD-1000-gaps";
  const trigger = bar(id, 2800, 106, 110, 100, 102, null);
  const e = episode(id, trigger, bar(id, 5500, 102, 103, 79, 80));
  const report = buildShadowReplayReport([e]);
  assert.equal(report.episodesAnalyzed, 1);
  assert.equal(report.episodesWith15mTape, 1);
  assert.equal(report.episodesWithGaps, 1);
  assert.ok(report.variants.every((v) => v.expired + v.decided <= v.candidates));
});

test("replay is deterministic", () => {
  const id = "XAUUSD-1000-deterministic";
  const trigger = bar(id, 2800, 106, 110, 100, 102, 2);
  const e = episode(id, trigger, bar(id, 3700, 102, 103, 79, 80));
  assert.deepEqual(buildShadowReplayReport([e]), buildShadowReplayReport([e]));
});
