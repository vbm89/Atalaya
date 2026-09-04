import assert from "node:assert/strict";
import test from "node:test";
import { auditShadowCapture, auditShadowCaptureBatch } from "./shadow-capture-audit";
import type { EpisodeDraft, SignalEventDraft } from "../watch/episode";
import type { EpisodeFreeze } from "../watch/freeze";

function freeze(state: "map" | "pending" | "entry" = "pending"): EpisodeFreeze {
  const all = state === "entry";
  return {
    slotClosePrice: 100,
    quality: "media",
    riskReward: 2,
    dataSource: "test",
    feedSymbol: "XAUUSD",
    instrumentKind: "spot",
    basis: 0,
    dataStatus: "ok",
    waitReason: null,
    highImpact: false,
    underlyingClosed: false,
    timeframe: "15m",
    setupKind: "continuation",
    capturedAtMs: 2_000_000,
    bias4hLabel: "BAJISTA LOCAL",
    missingForEntry: all ? null : "Falta: cierre 15M de fallo de aceptación o rechazo.",
    warnings: [],
    qualityPhase: all ? "final" : "preliminar",
    volumeRatio15: all ? 1.2 : null,
    volumeAvailable15: all,
    volumeRatio4h: all ? 1 : null,
    volumeAvailable4h: all,
    invalidation: 120,
    slWide: false,
    setupState: state,
    direction: "sell",
    entryGates: all
      ? {
          armed: true,
          t2: true,
          volume15: true,
          volume4h: true,
          bias4h: true,
          news: true,
          late: true,
          underlyingClosed: true,
        }
      : {
          armed: true,
          t2: false,
          volume15: false,
          volume4h: null,
          bias4h: true,
          news: true,
          late: true,
          underlyingClosed: true,
        },
  };
}

function episode(id = "XAUUSD-test"): EpisodeDraft {
  return {
    episodeId: id,
    assetId: "XAUUSD",
    direction: "sell",
    kind: "continuation",
    zoneLow: 100,
    zoneHigh: 110,
    sl: 115,
    tp1: 80,
    tp2: 70,
    openedAtMs: 1_000_000,
    openedState: "pending",
    currentState: "pending",
    closedAtMs: 3_000_000,
    levelsKey: "100-110-115-80",
    openedSlot: 1000,
    freeze: freeze(),
  };
}

function entryEvent(id: string): SignalEventDraft {
  return {
    episodeId: id,
    fromState: "pending",
    toState: "entry",
    atMs: 2_500_000,
    slot: 2500,
    notified: false,
  };
}

test("valid pending capture passes the integrity audit", () => {
  const ep = episode();
  const result = auditShadowCapture(ep, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("ENTRY capture requires coherent event timing", () => {
  const ep = { ...episode("entry"), currentState: "entry", freeze: freeze("entry") };
  const ev = entryEvent(ep.episodeId);
  assert.equal(auditShadowCapture(ep, [ev]).ok, true);

  const bad = { ...ev, atMs: 900_000, slot: 900 };
  const result = auditShadowCapture(ep, [bad]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("evento anterior al openedSlot"));
  assert.ok(result.issues.includes("ENTRY anterior a openedAtMs"));
});

test("postEntry is checked for causal timing and valid outcome", () => {
  const ep = episode("post");
  const good = auditShadowCapture(ep, [], {
    entryAtMs: 2_500_000,
    entrySlot: 2500,
    entryPrice: 100,
    outcome: "tp1",
  });
  assert.equal(good.ok, true);

  const bad = auditShadowCapture(ep, [], {
    entryAtMs: 900_000,
    entrySlot: 900,
    entryPrice: Number.NaN,
    outcome: "garbage",
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.includes("postEntry.entrySlot anterior al openedSlot"));
  assert.ok(bad.issues.includes("postEntry.entryAtMs anterior a openedAtMs"));
  assert.ok(bad.issues.includes("postEntry.entryPrice inválido"));
  assert.ok(bad.issues.includes("postEntry.outcome desconocido"));
});

test("batch audit is deterministic and counts invalid rows", () => {
  const good = episode("good");
  const bad = { ...episode("bad"), freeze: null };
  const report = auditShadowCaptureBatch([{ episode: good }, { episode: bad }]);
  assert.equal(report.episodes, 2);
  assert.equal(report.ok, 1);
  assert.equal(report.invalid, 1);
  assert.deepEqual(report.issues, [{ episodeId: "bad", issue: "episode_freeze ausente" }]);
});
