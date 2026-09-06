import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LearningCase } from "./case.ts";
import { isV1Trade, setupCases, v1TradeCases } from "./case.ts";
import { buildEvolution } from "./evolution.ts";
import { detectFindings } from "./patterns.ts";
import { summarize } from "./stats.ts";
import { runValidation, splitTemporal, TRAIN_RATIO } from "./validate.ts";

function lc(partial: Partial<LearningCase> = {}): LearningCase {
  return {
    episodeId: "e",
    assetId: "XAUUSD",
    direction: "buy",
    kind: "continuation",
    timeframe: "15m",
    openedAtMs: Date.parse("2026-01-01T08:00:00Z"),
    closedAtMs: Date.parse("2026-01-01T10:00:00Z"),
    openedState: "map",
    currentState: "wait",
    waitReason: null,
    missingForEntry: "volumen 15M",
    bias4hLabel: "ALCISTA",
    warnings: [],
    qualityPhase: "final",
    volumeRatio15: 1,
    volumeAvailable15: true,
    volumeRatio4h: 1,
    volumeAvailable4h: true,
    highImpact: false,
    underlyingClosed: false,
    dataStatus: "ok",
    zoneLow: 100,
    zoneHigh: 110,
    entry: 110,
    sl: 90,
    tp1: 130,
    tp2: 140,
    invalidation: 85,
    riskReward: 2.2,
    quality: "media",
    basis: null,
    outcome: "sl",
    firstTouch: "sl",
    firstTouchAtMs: Date.parse("2026-01-01T09:00:00Z"),
    mfe: 10,
    mae: 2,
    durationMs: 7_200_000,
    trainable: true,
    exclusionReason: null,
    complete: true,
    origin: "production",
    hadV1Entry: false,
    ...partial,
  };
}

function trade(partial: Partial<LearningCase> = {}): LearningCase {
  return lc({
    openedState: "pending",
    currentState: "wait",
    missingForEntry: null,
    hadV1Entry: true,
    outcome: "tp1",
    firstTouch: "tp1",
    ...partial,
  });
}

describe("P5 trade universe vs setup universe", () => {
  it("A MAP without ENTRY + SL is not a V1 trade", () => {
    const c = lc({ openedState: "map", hadV1Entry: false, outcome: "sl", firstTouch: "sl" });
    assert.equal(isV1Trade(c), false);
    assert.equal(v1TradeCases([c]).length, 0);
    assert.equal(summarize(v1TradeCases([c])).global.sl, 0);
    assert.equal(detectFindings([c]).findings.length, 0);
    assert.equal(runValidation([c], 1).tried, 0);
  });

  it("B PENDING without ENTRY + SL is not a V1 trade", () => {
    const c = lc({ openedState: "pending", hadV1Entry: false, outcome: "sl", firstTouch: "sl" });
    assert.equal(v1TradeCases([c]).length, 0);
    assert.equal(summarize(v1TradeCases([c])).global.sl, 0);
  });

  it("C MAP without ENTRY + TP is not a V1 winning trade", () => {
    const c = lc({ openedState: "map", hadV1Entry: false, outcome: "tp1", firstTouch: "tp1" });
    assert.equal(v1TradeCases([c]).length, 0);
    assert.equal(summarize(v1TradeCases([c])).global.tp1, 0);
    assert.equal(summarize(v1TradeCases([c])).global.success.hits, 0);
  });

  it("D PENDING without ENTRY + TP is not a V1 winning trade", () => {
    const c = lc({ openedState: "pending", hadV1Entry: false, outcome: "tp1", firstTouch: "tp1" });
    assert.equal(v1TradeCases([c]).length, 0);
    assert.equal(summarize(v1TradeCases([c])).global.tp1, 0);
  });

  it("E PENDING + ENTRY + TP is a V1 trade", () => {
    const c = trade({ outcome: "tp1", firstTouch: "tp1" });
    assert.equal(isV1Trade(c), true);
    assert.equal(summarize(v1TradeCases([c])).global.tp1, 1);
    assert.equal(summarize(v1TradeCases([c])).global.success.hits, 1);
  });

  it("F PENDING + ENTRY + SL is a V1 trade", () => {
    const c = trade({ outcome: "sl", firstTouch: "sl" });
    assert.equal(summarize(v1TradeCases([c])).global.sl, 1);
    assert.equal(summarize(v1TradeCases([c])).global.success.n, 1);
    assert.equal(summarize(v1TradeCases([c])).global.success.hits, 0);
  });

  it("G ENTRY is hadV1Entry from signal_events, never inferred from outcome", () => {
    const fakeWin = lc({ hadV1Entry: false, outcome: "tp1", firstTouch: "tp1", openedState: "entry" });
    const realLoss = trade({ hadV1Entry: true, outcome: "sl", firstTouch: "sl" });
    assert.equal(isV1Trade(fakeWin), false);
    assert.equal(isV1Trade(realLoss), true);
    const mixed = [fakeWin, realLoss];
    assert.deepEqual(v1TradeCases(mixed).map((c) => c.episodeId), [realLoss.episodeId]);
  });

  it("H setups without ENTRY remain in the setup universe", () => {
    const map = lc({ episodeId: "map", openedState: "map", hadV1Entry: false, outcome: "sl" });
    const pending = lc({ episodeId: "pend", openedState: "pending", hadV1Entry: false, outcome: "expired" });
    const entered = trade({ episodeId: "in" });
    const setups = setupCases([map, pending, entered]);
    assert.equal(setups.length, 3);
    assert.equal(v1TradeCases(setups).length, 1);
    assert.equal(summarize(setups).global.sl, 1);
    assert.equal(summarize(setups).global.expired, 1);
    assert.equal(summarize(setups).global.tp1, 1);
  });

  it("I TRAIN/TEST split stays chronological by openedAtMs then episodeId", () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      trade({
        episodeId: `t${String(i).padStart(2, "0")}`,
        openedAtMs: Date.parse("2026-01-01T08:00:00Z") + i * 86_400_000,
        outcome: i % 2 ? "sl" : "tp1",
        firstTouch: i % 2 ? "sl" : "tp1",
      }),
    );
    const a = splitTemporal(trades);
    const b = splitTemporal(trades);
    assert.deepEqual(
      a.train.map((c) => c.episodeId),
      b.train.map((c) => c.episodeId),
    );
    assert.equal(a.train.length, Math.floor(20 * TRAIN_RATIO));
    const lastTrain = a.train.at(-1)!.openedAtMs;
    const firstTest = a.test[0]!.openedAtMs;
    assert.ok(lastTrain <= firstTest);
    const polluted = [
      lc({ episodeId: "early-map", openedAtMs: trades[0]!.openedAtMs - 1, hadV1Entry: false, outcome: "sl" }),
      ...trades,
    ];
    const splitTrades = splitTemporal(v1TradeCases(polluted));
    assert.deepEqual(
      splitTrades.train.map((c) => c.episodeId),
      a.train.map((c) => c.episodeId),
    );
  });

  it("J filtering to trades does not use outcome timestamps as a future feature", () => {
    const c = trade({
      openedAtMs: 1_000,
      firstTouchAtMs: 9_999_999,
      closedAtMs: 9_999_999,
      outcome: "tp1",
    });
    assert.equal(isV1Trade(c), true);
    assert.ok(c.firstTouchAtMs! > c.openedAtMs);
    assert.equal(v1TradeCases([c])[0]!.openedAtMs, 1_000);
  });

  it("K old episodes without an ENTRY event stay setups, not trades", () => {
    const old = lc({
      episodeId: "legacy",
      hadV1Entry: false,
      outcome: "sl",
      openedState: "map",
      trainable: true,
    });
    assert.equal(v1TradeCases([old]).length, 0);
    assert.equal(setupCases([old]).length, 1);
    assert.equal(old.trainable, true);
  });

  it("L P5 performance ignores non-entry technical outcomes; setups still exist", () => {
    const maps = Array.from({ length: 40 }, (_, i) =>
      lc({
        episodeId: `map${i}`,
        openedAtMs: Date.parse("2026-01-01T08:00:00Z") + i * 86_400_000,
        hadV1Entry: false,
        outcome: "sl",
        firstTouch: "sl",
        kind: "continuation",
      }),
    );
    const entries = Array.from({ length: 4 }, (_, i) =>
      trade({
        episodeId: `in${i}`,
        openedAtMs: Date.parse("2026-02-01T08:00:00Z") + i * 86_400_000,
        outcome: "tp1",
        firstTouch: "tp1",
      }),
    );
    const all = [...maps, ...entries];
    const before = summarize(all).global;
    const after = summarize(v1TradeCases(all)).global;
    assert.equal(before.sl, 40);
    assert.equal(before.tp1, 4);
    assert.equal(before.success.n, 44);
    assert.equal(after.sl, 0);
    assert.equal(after.tp1, 4);
    assert.equal(after.success.n, 4);
    assert.equal(after.success.hits, 4);
    const evo = buildEvolution(all, detectFindings(all), runValidation(all, 1));
    assert.equal(evo.observed, 44);
    assert.equal(evo.trainable, 44);
    assert.equal(evo.decided, 4);
    assert.equal(detectFindings(all).findings.every((f) => f.baselineN <= 4), true);
  });
});
