import assert from "node:assert/strict";
import test from "node:test";
import { toShadowFeatures, type ShadowCaseInput } from "./shadow-features";
import { analyzeShadowReplay } from "./shadow-analysis";
import {
  buildShadowReplayReport,
  shadowCandidateForTest,
  shadowOutcomeForTest,
  slotToMs,
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

function bar(
  episodeId: string,
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number | null = null,
): ShadowTapeBar {
  return { episodeId, tf: "15m", t, o, h, l, c, v, role: "forward" };
}

function volumeHistory(id: string, v = 2): ShadowTapeBar[] {
  const out: ShadowTapeBar[] = [];
  for (let i = 0; i < 3; i += 1) {
    const t = 100 + i * 900;
    out.push(bar(id, t, 90, 91, 89, 90, v));
  }
  return out;
}

function episode(
  id: string,
  triggerBar: ShadowTapeBar,
  outcomeBar: ShadowTapeBar,
  events: ShadowEpisode["events"] = [],
  extra: Partial<ShadowEpisode> = {},
): ShadowEpisode {
  return {
    case: { ...baseCase(id), episodeId: id },
    events,
    bars: [...volumeHistory(id), triggerBar, outcomeBar],
    observedOutcome: null,
    ...extra,
  };
}

test("shadow-features derives only decision-time fields", () => {
  const features = toShadowFeatures(baseCase());
  assert.equal(features.assetId, "XAUUSD");
  assert.equal(features.rewardRisk1, 20 / 15);
  assert.equal("outcome" in features, false);
  assert.equal("firstTouch" in features, false);
});

test("candidate generation is outcome-blind", () => {
  const id = "XAUUSD-1000-blind";
  const trigger = bar(id, 2800, 108, 109, 100, 108, 2);
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
  const baseline = shadowCandidateForTest(e, "BASELINE_V1");
  const relaxed = shadowCandidateForTest(e, "VOLUME_RELAXED");
  const triggerRelaxed = shadowCandidateForTest(e, "TRIGGER_RELAXED");
  assert.equal(baseline, null);
  assert.equal(relaxed?.trigger, "reject");
  assert.equal(relaxed?.triggerVolumeAvailable, false);
  assert.equal(relaxed?.decisionSlot, 3700);
  assert.equal(triggerRelaxed, null, "TRIGGER_RELAXED must preserve the volume gate");
});

test("trigger-relaxed accepts a retest that is not fail-accept/reject when volume is present", () => {
  const id = "XAUUSD-1000-trigger";
  const trigger = bar(id, 2800, 107, 110, 100, 108, 2);
  const e = episode(id, trigger, bar(id, 3700, 108, 109, 79, 80));
  const candidate = shadowCandidateForTest(e, "TRIGGER_RELAXED");
  assert.equal(candidate?.trigger, "retest");
  assert.equal(candidate?.decisionSlot, 3700);
  assert.equal(shadowCandidateForTest(e, "VOLUME_RELAXED"), null);
});

test("volume+trigger relaxed accepts a retest without volume while trigger-relaxed does not", () => {
  const id = "XAUUSD-1000-both";
  const trigger = bar(id, 2800, 107, 110, 100, 108, null);
  const e = episode(id, trigger, bar(id, 3700, 108, 109, 79, 80));
  assert.equal(shadowCandidateForTest(e, "TRIGGER_RELAXED"), null);
  assert.equal(shadowCandidateForTest(e, "VOLUME_AND_TRIGGER_RELAXED")?.trigger, "retest");
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
  assert.equal(result.rrAtOutcome, -1);
  assert.equal(candidate.decisionBarTime, 2800);
  assert.ok((result.firstTouchAtSec ?? 0) >= candidate.decisionSlot);
});

test("MAPA -> PENDING -> ENTRADA remains observed-only for baseline", () => {
  const id = "XAUUSD-1000-states";
  const trigger = bar(id, 3700, 106, 110, 100, 102, 2);
  const e = episode(id, trigger, bar(id, 4600, 102, 103, 79, 80), [
    { episodeId: id, fromState: "map", toState: "pending", atMs: 3_700_000, slot: 3700 },
    { episodeId: id, fromState: "pending", toState: "entry", atMs: 4_600_000, slot: 4600 },
  ]);
  const baseline = shadowCandidateForTest(e, "BASELINE_V1");
  assert.equal(baseline?.decisionSlot, 4600);
  assert.equal(baseline?.decisionBarTime, 3700);
});

test("an unclosed 4H bar after the decision is not used as structure", () => {
  const id = "XAUUSD-1000-h4";
  const trigger = bar(id, 2800, 106, 110, 100, 102, 2);
  const e = episode(id, trigger, bar(id, 3700, 102, 103, 79, 80));
  const future4h: ShadowTapeBar[] = [];
  for (let i = 0; i < 12; i += 1) {
    const t = 2800 + i * 14400;
    future4h.push({
      episodeId: id,
      tf: "4h",
      t,
      o: 80 + i,
      h: 90 + i,
      l: 70 + i,
      c: 88 + i,
      v: 2,
      role: "forward",
    });
  }
  e.bars = [...e.bars, ...future4h];
  const candidate = shadowCandidateForTest(e, "VOLUME_RELAXED");
  assert.ok(candidate, "unclosed/future 4H HH/HL must not veto a valid sell reject");
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

test("train/test split compares decisionSlot seconds with openedAtMs", () => {
  const episodes: ShadowEpisode[] = [];
  for (let i = 0; i < 10; i += 1) {
    const id = `XAUUSD-${i}`;
    const openedSlot = 1_700_000_000 + i * 900;
    const triggerT = openedSlot;
    const e = episode(id, bar(id, triggerT, 106, 110, 100, 102, 2), bar(id, triggerT + 900, 102, 103, 79, 80));
    e.case = { ...e.case, episodeId: id, openedSlot, openedAtMs: slotToMs(openedSlot), openedState: "pending" };
    episodes.push(e);
  }
  const report = buildShadowReplayReport(episodes);
  const volume = report.variants.find((v) => v.variant === "VOLUME_RELAXED");
  assert.ok(volume);
  assert.ok(volume.train.n > 0);
  assert.ok(volume.test.n > 0);
  assert.equal(volume.train.n + volume.test.n, volume.candidates);
});

test("small TEST samples are marked INSUFFICIENT, not evidence of improvement", () => {
  const id = "XAUUSD-1000-small";
  const e = episode(id, bar(id, 2800, 106, 110, 100, 102, 2), bar(id, 3700, 102, 103, 79, 80));
  const analysis = analyzeShadowReplay([e]);
  assert.ok(analysis.comparisons.every((c) => c.recommendation === "INSUFFICIENT"));
  assert.ok(analysis.comparisons.every((c) => c.testN < 30));
});
