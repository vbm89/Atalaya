import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LearningCase } from "./case.ts";
import {
  ASSET_ORDER,
  evidenceLevel,
  evidenceLabel,
  formatPct,
  rate,
  rrBand,
  summarize,
  wilsonInterval,
} from "./stats.ts";

function lc(partial: Partial<LearningCase> = {}): LearningCase {
  return {
    episodeId: partial.episodeId ?? "e",
    assetId: "BTCUSD",
    direction: "sell",
    kind: "continuation",
    timeframe: "15m",
    openedAtMs: Date.parse("2026-09-01T08:00:00Z"),
    closedAtMs: Date.parse("2026-09-01T10:00:00Z"),
    openedState: "entry",
    currentState: "wait",
    waitReason: null,
    missingForEntry: null,
    bias4hLabel: "BAJISTA LOCAL · BOS",
    warnings: [],
    qualityPhase: "final",
    volumeRatio15: 1.2,
    volumeAvailable15: true,
    volumeRatio4h: 1,
    volumeAvailable4h: true,
    highImpact: false,
    underlyingClosed: false,
    dataStatus: "ok",
    zoneLow: 100,
    zoneHigh: 110,
    entry: 100,
    sl: 120,
    tp1: 80,
    tp2: 70,
    invalidation: 125,
    riskReward: 2.5,
    quality: "media",
    basis: null,
    outcome: "tp1",
    firstTouch: "tp1",
    firstTouchAtMs: Date.parse("2026-09-01T09:00:00Z"),
    mfe: 20,
    mae: 5,
    durationMs: 7_200_000,
    trainable: true,
    exclusionReason: null,
    complete: true,
    ...partial,
  };
}

describe("P5.3 outcomes", () => {
  it("TP1 counts as success, TP2 is not a second trade", () => {
    const cases = [
      lc({ episodeId: "a", outcome: "tp1" }),
      lc({ episodeId: "b", outcome: "tp2" }),
      lc({ episodeId: "c", outcome: "sl" }),
    ];
    const s = summarize(cases).global;
    assert.equal(s.tp1, 1);
    assert.equal(s.tp2, 1);
    assert.equal(s.success.hits, 2);
    assert.equal(s.success.n, 3);
    assert.equal(s.tp2Share.hits, 1);
    assert.equal(s.tp2Share.n, 3);
  });

  it("SL is the primary failure", () => {
    const s = summarize([lc({ outcome: "sl" }), lc({ outcome: "sl" }), lc({ outcome: "tp1" })]).global;
    assert.equal(s.sl, 2);
    assert.equal(s.fail.hits, 2);
    assert.equal(s.fail.n, 3);
  });

  it("EXPIRADA is neither success nor failure", () => {
    const s = summarize([
      lc({ episodeId: "a", outcome: "tp1" }),
      lc({ episodeId: "b", outcome: "expired" }),
      lc({ episodeId: "c", outcome: "sl" }),
    ]).global;
    assert.equal(s.expired, 1);
    assert.equal(s.success.hits, 1);
    assert.equal(s.fail.hits, 1);
    assert.equal(s.success.n, 2);
  });

  it("PENDING is excluded from stats", () => {
    const s = summarize([
      lc({
        episodeId: "p",
        outcome: "pending",
        trainable: false,
        exclusionReason: "OUTCOME_PENDING",
      }),
      lc({ episodeId: "a", outcome: "tp1" }),
    ]).global;
    assert.equal(s.pending, 1);
    assert.equal(s.trainable, 1);
    assert.equal(s.excluded, 1);
    assert.equal(s.success.n, 1);
  });

  it("trainable=false is excluded even with a closed outcome", () => {
    const s = summarize([
      lc({ episodeId: "bad", outcome: "tp1", trainable: false, exclusionReason: "LEVELS_INCOHERENT" }),
      lc({ episodeId: "ok", outcome: "sl" }),
    ]).global;
    assert.equal(s.trainable, 1);
    assert.equal(s.tp1, 0);
    assert.equal(s.sl, 1);
  });
});

describe("P5.3 rates and evidence", () => {
  it("n always appears with the percentage", () => {
    const r = rate(2, 4);
    assert.equal(r.n, 4);
    assert.equal(r.pct, 0.5);
    assert.match(formatPct(r), /n = 4/);
    assert.match(formatPct(r), /50,0 %/);
  });

  it("percentage is exact for a known sample", () => {
    const s = summarize([
      lc({ episodeId: "1", outcome: "tp1" }),
      lc({ episodeId: "2", outcome: "tp1" }),
      lc({ episodeId: "3", outcome: "sl" }),
      lc({ episodeId: "4", outcome: "sl" }),
    ]).global;
    assert.equal(s.success.pct, 0.5);
    assert.equal(s.success.n, 4);
  });

  it("evidence thresholds", () => {
    assert.equal(evidenceLevel(19), "insufficient");
    assert.equal(evidenceLevel(20), "observation");
    assert.equal(evidenceLevel(49), "observation");
    assert.equal(evidenceLevel(50), "potential_pattern");
    assert.equal(evidenceLevel(79), "potential_pattern");
    assert.equal(evidenceLevel(80), "stronger");
    assert.match(evidenceLabel("potential_pattern"), /no validado/i);
    assert.match(evidenceLabel("stronger"), /No implica cambiar V1/);
  });

  it("n>=80 does not imply V1.1", () => {
    const many = Array.from({ length: 80 }, (_, i) => lc({ episodeId: `e${i}`, outcome: i % 2 ? "tp1" : "sl" }));
    const s = summarize(many).global;
    assert.equal(s.evidence, "stronger");
    assert.match(evidenceLabel(s.evidence), /No implica cambiar V1/);
  });
});

describe("P5.3 segmentation", () => {
  it("does not mix XAU and BTC in the per-asset view", () => {
    const s = summarize([
      lc({ episodeId: "x", assetId: "XAUUSD", outcome: "tp1" }),
      lc({ episodeId: "b", assetId: "BTCUSD", outcome: "sl" }),
    ]);
    assert.deepEqual(ASSET_ORDER, ["XAUUSD", "BTCUSD", "US100", "WTI"]);
    const xau = s.byAsset.find((b) => b.key === "XAUUSD")!;
    const btc = s.byAsset.find((b) => b.key === "BTCUSD")!;
    assert.equal(xau.tp1, 1);
    assert.equal(xau.sl, 0);
    assert.equal(btc.sl, 1);
    assert.equal(btc.tp1, 0);
    assert.equal(xau.trainable, 1);
    assert.equal(btc.trainable, 1);
  });

  it("R:R uses fixed bands", () => {
    assert.equal(rrBand(1.5), "lt2");
    assert.equal(rrBand(2), "2to3");
    assert.equal(rrBand(2.9), "2to3");
    assert.equal(rrBand(3), "gte3");
    assert.equal(rrBand(null), "unknown");
    const s = summarize([
      lc({ episodeId: "a", riskReward: 1.2, outcome: "tp1" }),
      lc({ episodeId: "b", riskReward: 2.2, outcome: "sl" }),
      lc({ episodeId: "c", riskReward: 4, outcome: "tp1" }),
      lc({ episodeId: "d", riskReward: null, outcome: "expired" }),
    ]);
    assert.equal(s.byRr.find((b) => b.key === "lt2")?.trainable, 1);
    assert.equal(s.byRr.find((b) => b.key === "2to3")?.trainable, 1);
    assert.equal(s.byRr.find((b) => b.key === "gte3")?.trainable, 1);
    assert.equal(s.byRr.find((b) => b.key === "unknown")?.trainable, 1);
  });

  it("period uses openedAtMs of trainable cases", () => {
    const a = Date.parse("2026-09-01T08:00:00Z");
    const b = Date.parse("2026-11-30T08:00:00Z");
    const s = summarize([
      lc({ episodeId: "1", openedAtMs: a, outcome: "tp1" }),
      lc({ episodeId: "2", openedAtMs: b, outcome: "sl" }),
    ]).global;
    assert.equal(s.periodFromMs, a);
    assert.equal(s.periodToMs, b);
  });

  it("missing data does not invent rates", () => {
    const empty = summarize([]);
    assert.equal(empty.global.success.pct, null);
    assert.equal(empty.global.success.n, 0);
    assert.equal(empty.global.meanMfe, null);
    assert.match(formatPct(empty.global.success), /n\/d/);
  });

  it("is reproducible", () => {
    const cases = [
      lc({ episodeId: "1", assetId: "XAUUSD", outcome: "tp1" }),
      lc({ episodeId: "2", assetId: "BTCUSD", outcome: "sl" }),
    ];
    assert.deepEqual(summarize(cases), summarize(cases));
  });
});

describe("P5.3 wilson / V1 untouched contract", () => {
  it("wilson is defined only when n>0", () => {
    assert.equal(wilsonInterval(0, 0), null);
    const w = wilsonInterval(8, 10);
    assert.ok(w && w.low > 0 && w.high < 1 && w.low < 0.8 && w.high > 0.8);
  });
});
