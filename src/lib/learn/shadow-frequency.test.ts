import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ShadowCaseInput } from "./shadow-features.ts";
import type { ShadowEpisode, ShadowTapeBar } from "./shadow-replay.ts";
import { shadowCandidateForTest, shadowOutcomeForTest, SHADOW_VARIANTS } from "./shadow-replay.ts";
import {
  FREQUENCY_STRATEGIES,
  SHADOW_FREQUENCY_PLAN,
  buildShadowFrequencyDensity,
  buildShadowFrequencyReport,
  evaluateFrequencyPromotion,
  opportunitiesPerDay,
  replayFrequencyCandidates,
} from "./shadow-frequency.ts";

function baseCase(id = "XAUUSD-1000-freq"): ShadowCaseInput {
  return {
    episodeId: id,
    assetId: "XAUUSD",
    direction: "sell",
    kind: "break-retest",
    openedAtMs: 1_000_000,
    openedSlot: 1_000,
    openedState: "map",
    currentState: "map",
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

function bar(
  episodeId: string,
  t: number,
  o: number,
  h: number,
  l: number,
  c: number,
  v: number | null = 2,
): ShadowTapeBar {
  return { episodeId, tf: "15m", t, o, h, l, c, v, role: "forward" };
}

function volumeLookback(id: string): ShadowTapeBar[] {
  const out: ShadowTapeBar[] = [];
  for (let i = 0; i < 8; i += 1) {
    out.push(bar(id, 100 + i * 900, 105, 106, 104, 105, 2));
  }
  return out;
}

function episode(partial: Partial<ShadowEpisode> & { id?: string; bars: ShadowTapeBar[]; events?: ShadowEpisode["events"] }): ShadowEpisode {
  const id = partial.id ?? partial.case?.episodeId ?? "XAUUSD-1000-freq";
  return {
    case: { ...baseCase(id), ...(partial.case ?? {}) },
    events: partial.events ?? [],
    bars: partial.bars,
    observedOutcome: partial.observedOutcome ?? null,
  };
}

describe("shadow frequency research plan", () => {
  it("never lives, never modifies V1, never synthesizes 5M/1M, never tunes TEST", () => {
    assert.equal(SHADOW_FREQUENCY_PLAN.liveSignal, false);
    assert.equal(SHADOW_FREQUENCY_PLAN.modifiesV1, false);
    assert.equal(SHADOW_FREQUENCY_PLAN.synthesizesLowerTf, false);
    assert.equal(SHADOW_FREQUENCY_PLAN.optimizesOnTest, false);
    assert.ok(!SHADOW_VARIANTS.includes("BREAKOUT_RETEST"));
    assert.ok(!SHADOW_VARIANTS.includes("MOMENTUM_PULLBACK"));
    assert.deepEqual([...FREQUENCY_STRATEGIES], [
      "BREAKOUT_RETEST",
      "LIQUIDITY_SWEEP",
      "FVG_RETEST",
      "MOMENTUM_PULLBACK",
    ]);
  });

  it("frequency 5-10/day never promotes", () => {
    const hot = evaluateFrequencyPromotion({
      extraTestN: 80,
      trainExpectancyR: 0.8,
      testExpectancyR: 0.6,
      opportunitiesPerDay: 12,
      assetSuccessRangePp: 5,
      sessionSuccessRangePp: 5,
      assetCoverage: 4,
      sessionCoverage: 3,
    });
    assert.equal(hot.live, false);
    assert.equal(hot.noLookahead, "demonstrated_by_tests");
    assert.equal(hot.status, "KEEP_RESEARCH");
    assert.equal(hot.frequencyInBand, false);
    assert.ok(hot.reasons.some((r) => /informativa/i.test(r)));
  });

  it("expired/pending stay out of the success denominator", () => {
    const p = evaluateFrequencyPromotion({
      extraTestN: 2,
      trainExpectancyR: null,
      testExpectancyR: null,
      opportunitiesPerDay: null,
      assetSuccessRangePp: null,
      sessionSuccessRangePp: null,
      assetCoverage: 0,
      sessionCoverage: 0,
    });
    assert.equal(p.status, "INSUFFICIENT");
    assert.equal(p.meetsSample, false);
  });
});

describe("MAP vs ENTRY and EXTRA vs OVERLAP", () => {
  it("MAP without ENTRY can still produce a frequency EXTRA candidate", () => {
    const id = "XAUUSD-map-extra";
    const lookback = volumeLookback(id);
    const breakout = bar(id, 8200, 99, 100, 94, 95, 2);
    const retest = bar(id, 9100, 96, 105, 95, 101, 2);
    const ep = episode({
      id,
      case: { ...baseCase(id), openedState: "map", currentState: "map" },
      events: [],
      bars: [...lookback, breakout, retest, bar(id, 10_000, 101, 102, 70, 75, 2)],
    });
    const c = shadowCandidateForTest(ep, "BREAKOUT_RETEST");
    assert.ok(c);
    assert.equal(c!.variant, "BREAKOUT_RETEST");
    const report = buildShadowFrequencyReport([ep]);
    const row = report.strategies.find((s) => s.strategy === "BREAKOUT_RETEST")!;
    assert.equal(row.extra, 1);
    assert.equal(row.overlap, 0);
    assert.equal(report.v1Entries, 0);
  });

  it("V1 ENTRY on the same map is OVERLAP, not EXTRA", () => {
    const id = "XAUUSD-overlap";
    const lookback = volumeLookback(id);
    const breakout = bar(id, 8200, 99, 100, 94, 95, 2);
    const retest = bar(id, 9100, 96, 105, 95, 101, 2);
    const ep = episode({
      id,
      case: { ...baseCase(id), openedState: "map", currentState: "entry" },
      events: [{ episodeId: id, fromState: "pending", toState: "entry", atMs: 10_000_000, slot: 10_000 }],
      bars: [...lookback, breakout, retest],
    });
    const report = buildShadowFrequencyReport([ep]);
    const row = report.strategies.find((s) => s.strategy === "BREAKOUT_RETEST")!;
    assert.equal(report.v1Entries, 1);
    assert.equal(row.overlap, 1);
    assert.equal(row.extra, 0);
  });
});

describe("anti look-ahead", () => {
  it("candidate generation ignores future TP/SL bars", () => {
    const id = "XAUUSD-la";
    const lookback = volumeLookback(id);
    const mom = bar(id, 8200, 104, 104, 90, 91, 2);
    const pull = bar(id, 9100, 96, 108, 95, 101, 2);
    const win = bar(id, 10_000, 101, 102, 70, 72, 2);
    const lose = bar(id, 10_000, 101, 130, 100, 120, 2);
    const a = episode({ id, bars: [...lookback, mom, pull, win] });
    const b = episode({ id, bars: [...lookback, mom, pull, lose], observedOutcome: "sl" });
    const ca = shadowCandidateForTest(a, "MOMENTUM_PULLBACK");
    const cb = shadowCandidateForTest(b, "MOMENTUM_PULLBACK");
    assert.ok(ca && cb);
    assert.equal(ca!.decisionSlot, cb!.decisionSlot);
    assert.equal(ca!.decisionBarTime, cb!.decisionBarTime);
    assert.equal(ca!.trigger, "momentum_pullback");
  });

  it("decision does not use bars after the pullback", () => {
    const id = "XAUUSD-future";
    const lookback = volumeLookback(id);
    const mom = bar(id, 8200, 104, 104, 90, 91, 2);
    const pull = bar(id, 9100, 96, 108, 95, 101, 2);
    const later = bar(id, 20_000, 101, 102, 50, 55, 2);
    const ep = episode({ id, bars: [...lookback, mom, pull, later] });
    const c = shadowCandidateForTest(ep, "MOMENTUM_PULLBACK");
    assert.ok(c);
    assert.ok(c!.decisionBarTime < later.t);
  });
});

describe("same-bar SL+TP", () => {
  it("same posterior bar SL and TP1 → SL", () => {
    const id = "XAUUSD-same";
    const lookback = volumeLookback(id);
    const mom = bar(id, 8200, 104, 104, 90, 91, 2);
    const pull = bar(id, 9100, 96, 108, 95, 101, 2);
    const both = bar(id, 12_000, 101, 130, 70, 90, 2);
    const ep = episode({ id, bars: [...lookback, mom, pull, both] });
    const c = shadowCandidateForTest(ep, "MOMENTUM_PULLBACK");
    assert.ok(c);
    const o = shadowOutcomeForTest(c!, ep);
    assert.equal(o.outcome, "sl");
  });
});

describe("frequency metrics", () => {
  it("success uses only decided rows and counts opportunities/day", () => {
    const id = "BTCUSD-day";
    const lookback = volumeLookback(id);
    const mom = bar(id, 8200, 104, 104, 90, 91, 2);
    const pull = bar(id, 9100, 96, 108, 95, 101, 2);
    const tp = bar(id, 12_000, 101, 102, 70, 72, 2);
    const ep = episode({
      id,
      case: { ...baseCase(id), assetId: "BTCUSD", openedAtMs: Date.parse("2026-09-10T08:00:00Z") },
      bars: [...lookback, mom, pull, tp],
    });
    const rows = replayFrequencyCandidates([ep], "MOMENTUM_PULLBACK");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.outcome, "tp1");
    const report = buildShadowFrequencyReport([ep]);
    const row = report.strategies.find((s) => s.strategy === "MOMENTUM_PULLBACK")!;
    assert.equal(row.tp1, 1);
    assert.equal(row.sl, 0);
    assert.equal(row.pending, 0);
    assert.equal(row.successPct, 100);
    assert.ok((row.opportunitiesPerDay ?? 0) > 0);
    assert.equal(opportunitiesPerDay(10, 2), 5);
    assert.equal(report.lowerTf.synthesized, false);
    assert.equal(report.lowerTf.used, false);
  });

  it("a losing high-frequency strategy is DISCARD when sample is enough and TRAIN expectancy is negative", () => {
    const promo = evaluateFrequencyPromotion({
      extraTestN: 40,
      trainExpectancyR: -0.4,
      testExpectancyR: -0.2,
      opportunitiesPerDay: 10,
      assetSuccessRangePp: 8,
      sessionSuccessRangePp: 6,
      assetCoverage: 4,
      sessionCoverage: 3,
    });
    assert.equal(promo.status, "DISCARD");
    assert.equal(promo.frequencyInBand, true);
    assert.equal(promo.live, false);
  });

  it("daily density separates V1 ENTRY from EXTRA and excludes expired from decided", () => {
    const day = "2026-09-10";
    const episodes = [
      { case: { episodeId: "a", openedAtMs: Date.parse(`${day}T10:00:00Z`) }, events: [{ toState: "entry", slot: 1 }], bars: [] },
      { case: { episodeId: "b", openedAtMs: Date.parse(`${day}T11:00:00Z`) }, events: [], bars: [] },
    ] as any;
    const results = [
      { episodeId: "a", outcome: "tp1" },
      { episodeId: "b", outcome: "expired" },
    ] as any;
    const report = buildShadowFrequencyDensity(episodes, results);
    assert.equal(report.days[0]?.v1Entries, 1);
    assert.equal(report.days[0]?.shadowCandidates, 2);
    assert.equal(report.days[0]?.shadowDecided, 1);
    assert.equal(report.days[0]?.extraCandidates, 1);
    assert.equal(report.days[0]?.extraDecided, 0);
  });
});
