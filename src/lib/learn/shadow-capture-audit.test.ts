import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  VOLUME_SNAPSHOT_VS_GATE,
  auditShadowCapture,
  auditShadowCaptureBatch,
  freezeWriteOnceSqlIntact,
} from "./shadow-capture-audit";
import type { EpisodeDraft, SignalEventDraft } from "../watch/episode";
import type { EpisodeFreeze } from "../watch/freeze";
import type { SetupState } from "../trading/types";
import type { EntryGates } from "../watch/entry-gates";

function freeze(state: "map" | "pending" | "entry" = "pending"): EpisodeFreeze {
  const all = state === "entry";
  const map = state === "map";
  const entryGates: EntryGates = map
    ? {
        armed: false,
        t2: null,
        volume15: null,
        volume4h: null,
        bias4h: null,
        news: null,
        late: null,
        underlyingClosed: null,
      }
    : all
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
        };
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
    missingForEntry: map
      ? "Falta: salida 15M de la zona a favor."
      : all
        ? null
        : "Falta: cierre 15M de fallo de aceptación o rechazo.",
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
    entryGates,
  };
}

function episode(id = "XAUUSD-test", state: SetupState = "pending"): EpisodeDraft {
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
    openedState: state,
    currentState: state,
    closedAtMs: 3_000_000,
    levelsKey: "100-110-115-80",
    openedSlot: 1000,
    freeze: freeze(state === "wait" ? "pending" : state),
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
  const ep = episode("entry", "entry");
  const ev = entryEvent(ep.episodeId);
  assert.equal(auditShadowCapture(ep, [ev]).ok, true);

  const bad = { ...ev, atMs: 900_000, slot: 900 };
  const result = auditShadowCapture(ep, [bad]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("evento anterior al openedSlot"));
  assert.ok(result.issues.includes("ENTRY anterior a openedAtMs"));
});

test("MAP with invented gates fails", () => {
  const ep = episode("map", "map");
  assert.equal(auditShadowCapture(ep, []).ok, true);
  const invented: EpisodeFreeze = {
    ...freeze("map"),
    entryGates: {
      armed: false,
      t2: true,
      volume15: true,
      volume4h: true,
      bias4h: true,
      news: true,
      late: true,
      underlyingClosed: true,
    },
  };
  const result = auditShadowCapture({ ...ep, freeze: invented }, []);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("MAP no debe inventar t2"));
  assert.ok(result.issues.includes("MAP no debe inventar volume4h"));
});

test("PENDING volume4h=true without 4H snippet fails; null is valid", () => {
  const ep = episode("p4h");
  assert.equal(ep.freeze?.entryGates?.volume4h ?? null, null);
  assert.equal(auditShadowCapture(ep, []).ok, true);
  const fakeTrue: EpisodeFreeze = {
    ...freeze("pending"),
    missingForEntry: "Falta: cierre 15M de fallo de aceptación o rechazo.",
    entryGates: { ...freeze("pending").entryGates!, volume4h: true },
  };
  const result = auditShadowCapture({ ...ep, freeze: fakeTrue }, []);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("PENDING volume4h=true sin evidencia de evaluación 4H"));
});

test("postEntry without ENTRY event fails", () => {
  const ep = episode("orphan");
  const result = auditShadowCapture(ep, [], {
    entryAtMs: 2_500_000,
    entrySlot: 2500,
    entryPrice: 100,
    outcome: "tp1",
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("postEntry sin evento ENTRY"));
});

test("currentState=ENTRY without entry event fails", () => {
  const ep = episode("no-event", "entry");
  const result = auditShadowCapture(ep, []);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes("ENTRY sin evento to_state=entry"));
});

test("old freeze without entryGates is not_checkable, not corrupt", () => {
  const raw = freeze("pending");
  const { entryGates: _drop, ...legacy } = raw;
  const ep: EpisodeDraft = { ...episode("legacy"), freeze: legacy };
  const result = auditShadowCapture(ep, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.ok(result.skipped.some((s) => /histórico no comprobable/.test(s)));
  const batch = auditShadowCaptureBatch([{ episode: ep }]);
  assert.equal(batch.ok, 1);
  assert.equal(batch.invalid, 0);
  assert.equal(batch.notCheckable, 1);
});

test("postEntry causal timing, price, and firstTouch", () => {
  const ep = episode("post");
  const ev = entryEvent(ep.episodeId);
  const good = auditShadowCapture(ep, [ev], {
    entryAtMs: 2_500_000,
    entrySlot: 2500,
    entryPrice: 100,
    firstTouchAtSec: 2500,
    mfe: 1,
    mae: 2,
    outcome: "tp1",
  });
  assert.equal(good.ok, true);

  const bad = auditShadowCapture(ep, [ev], {
    entryAtMs: 900_000,
    entrySlot: 900,
    entryPrice: Number.NaN,
    firstTouchAtSec: 100,
    mfe: Number.NaN,
    outcome: "garbage",
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.includes("postEntry.entrySlot anterior al openedSlot"));
  assert.ok(bad.issues.includes("postEntry.entryAtMs anterior a openedAtMs"));
  assert.ok(bad.issues.includes("postEntry.entryPrice inválido"));
  assert.ok(bad.issues.includes("postEntry.outcome desconocido"));
  assert.ok(bad.issues.includes("postEntry.firstTouchAtSec anterior al entrySlot"));
  assert.ok(bad.issues.includes("postEntry.mfe inválido"));

  const wrongPrice = auditShadowCapture(ep, [ev], {
    entryAtMs: 2_500_000,
    entrySlot: 2500,
    entryPrice: 110,
    outcome: "tp1",
  });
  assert.equal(wrongPrice.ok, false);
  assert.ok(wrongPrice.issues.includes("postEntry.entryPrice incoherente con zona/dirección"));
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

test("write-once: upsert ON CONFLICT does not rewrite episode_freeze", () => {
  const storePath = join(dirname(fileURLToPath(import.meta.url)), "../watch/store.ts");
  const sql = readFileSync(storePath, "utf8");
  assert.equal(freezeWriteOnceSqlIntact(sql), true);
  assert.equal(
    freezeWriteOnceSqlIntact("on conflict (episode_id) do update set episode_freeze = excluded.episode_freeze"),
    false,
  );
});

test("volume snapshot is not used as the V1 gate", () => {
  assert.match(VOLUME_SNAPSHOT_VS_GATE, /not interchangeable/);
  const ep = episode("vol");
  assert.equal(ep.freeze?.volumeRatio15, null);
  assert.equal(ep.freeze?.entryGates?.volume15, false);
});
