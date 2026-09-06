import test from "node:test";
import assert from "node:assert/strict";
import { buildShadowRadar } from "./shadow-radar";
import type { HistoryRow } from "@/lib/watch/store";

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    episode: {
      episodeId: "episode-123456",
      assetId: "BTCUSD",
      direction: "buy",
      kind: "retest",
      zoneLow: 100,
      zoneHigh: 101,
      sl: 99,
      tp1: 103,
      tp2: 105,
      openedAtMs: 1_700_000_000_000,
      openedState: "map",
      currentState: "wait",
      closedAtMs: 1_700_000_900_000,
      levelsKey: "x",
      openedSlot: 1,
      freeze: {
        slotClosePrice: 100,
        quality: "alta",
        riskReward: 2,
        dataSource: "test",
        feedSymbol: "BTCUSDT",
        instrumentKind: "crypto",
        basis: 0,
        dataStatus: "ok",
        waitReason: "Falta confirmación",
        highImpact: false,
        underlyingClosed: false,
        timeframe: "15m",
        setupKind: "retest",
        capturedAtMs: 1,
        bias4hLabel: "alcista",
        missingForEntry: "confirmación",
        warnings: [],
        volumeRatio15: 1.2,
        volumeAvailable15: true,
        volumeRatio4h: 1.1,
        volumeAvailable4h: true,
        invalidation: 99,
        slWide: false,
        setupState: "map",
        direction: "buy",
        entryGates: null,
      },
    },
    outcome: "tp1",
    firstTouch: "tp1",
    firstTouchAtMs: 1_700_001_000_000,
    mfe: 4,
    mae: 0.5,
    hadV1Entry: false,
    ...overrides,
  };
}

test("radar only promotes non-entry cases that reached at least 1R", () => {
  const result = buildShadowRadar([
    row(),
    row({ episode: { ...row().episode, episodeId: "episode-222222" }, mfe: 0.5 }),
    row({ episode: { ...row().episode, episodeId: "episode-333333" }, hadV1Entry: true }),
  ]);
  assert.equal(result.stats.evaluated, 2);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0]?.mfeR, 4);
  assert.equal(result.cases[0]?.firstTouch, "tp1");
});

test("radar preserves frozen context for replay", () => {
  const result = buildShadowRadar([row()]);
  const item = result.cases[0];
  assert.ok(item);
  assert.equal(item.bias4h, "alcista");
  assert.equal(item.missingForEntry, "confirmación");
  assert.equal(item.volumeRatio15, 1.2);
  assert.equal(item.replay.entry, 100);
  assert.equal(item.replay.sl, 99);
  assert.equal(item.replay.tp1, 103);
});
