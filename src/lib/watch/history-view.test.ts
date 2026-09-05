import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EpisodeDraft } from "./episode.ts";
import type { EpisodeFreeze } from "./freeze.ts";
import type { HistoryRow } from "./store.ts";
import {
  HISTORY_DISCLAIMER,
  entryPrice,
  historyBuckets,
  historyCardModel,
  kindLabel,
  setupWithoutEntryLabel,
  wickNote,
} from "./history-view.ts";

const freeze: EpisodeFreeze = {
  slotClosePrice: 77747,
  quality: "media",
  riskReward: 1.8,
  dataSource: "binance",
  feedSymbol: "BTCUSDT",
  instrumentKind: "proxy",
  basis: null,
  dataStatus: "ok",
  waitReason: null,
  highImpact: false,
  underlyingClosed: false,
  timeframe: "15m",
  setupKind: "continuation",
  capturedAtMs: Date.parse("2026-08-29T08:15:00Z"),
};

function episode(partial: Partial<EpisodeDraft> = {}): EpisodeDraft {
  return {
    episodeId: "BTCUSD-test",
    assetId: "BTCUSD",
    direction: "sell",
    kind: "continuation",
    zoneLow: 77500,
    zoneHigh: 77600,
    sl: 78150,
    tp1: 77100,
    tp2: 76800,
    openedAtMs: Date.parse("2026-08-29T08:15:00Z"),
    openedState: "entry",
    currentState: "entry",
    closedAtMs: null,
    levelsKey: "k",
    openedSlot: 1_000,
    freeze,
    ...partial,
  };
}

function row(partial: Partial<HistoryRow> = {}): HistoryRow {
  return {
    episode: episode(),
    outcome: "pending",
    firstTouch: null,
    firstTouchAtMs: null,
    mfe: null,
    mae: null,
    ...partial,
  };
}

describe("history-view", () => {
  it("SHORT entry is the low of the zone, not a fabricated price", () => {
    assert.equal(entryPrice("sell", 77500, 77600), 77500);
    assert.equal(entryPrice("buy", 77500, 77600), 77600);
    assert.equal(entryPrice("sell", 4303.98, 4338.15), 4303.98);
    assert.equal(entryPrice("buy", 4303.98, 4338.15), 4338.15);
  });

  it("does not invent WIN/LOSS labels", () => {
    const card = historyCardModel(
      row({
        outcome: "tp1",
        firstTouch: "tp1",
        firstTouchAtMs: Date.parse("2026-08-29T08:30:00Z"),
        hadV1Entry: true,
      }),
    );
    assert.equal(card.outcome, "TP1");
    assert.equal(card.entryV1Label, "SÍ");
    assert.equal(card.isTradeOutcome, true);
    assert.doesNotMatch(card.outcome, /WIN|LOSS|ganad|perdid/i);
    assert.doesNotMatch(card.wick, /WIN|LOSS/i);
    assert.ok(card.disclaimer.includes(HISTORY_DISCLAIMER));
    assert.match(card.disclaimer, /BTCUSDT/);
    assert.equal(card.timeframe, "M15");
    assert.equal(card.signalOpened, "ENTRADA");
    assert.equal(card.direction, "VENTA");
    assert.ok(card.tp2);
    assert.match(card.wick, /Mecha 15M tocó TP1/);
  });

  it("wick TP1 on a still-open episode is TP1, not a live PENDIENTE that hides the touch", () => {
    const card = historyCardModel(
      row({
        outcome: "tp1",
        firstTouch: "tp1",
        firstTouchAtMs: Date.parse("2026-08-29T08:30:00Z"),
        hadV1Entry: true,
      }),
    );
    assert.equal(card.outcome, "TP1");
    assert.match(card.wick, /Mecha 15M tocó TP1/);
  });

  it("expired is not a fake win", () => {
    const note = wickNote(
      row({
        episode: episode({ closedAtMs: Date.parse("2026-08-29T10:00:00Z"), currentState: "wait" }),
        outcome: "expired",
      }),
    );
    assert.match(note, /No es un WIN\/LOSS inventado/);
  });

  it("kind labels stay on V1 vocabulary", () => {
    assert.equal(kindLabel("continuation"), "continuación");
    assert.equal(kindLabel("break-retest"), "ruptura + retest");
  });

  it("live PENDING is PENDING, not a generic open trade", () => {
    const card = historyCardModel(
      row({
        episode: episode({ openedState: "pending", currentState: "pending" }),
        outcome: "pending",
        hadV1Entry: false,
      }),
    );
    assert.equal(card.outcome, "PENDING");
    assert.equal(card.episodeState, "PENDING");
    assert.equal(card.hadV1Entry, false);
    assert.equal(card.entryV1Label, "NO");
    assert.equal(card.isTradeOutcome, false);
    assert.match(card.wick, /no son operaciones/i);
  });

  it("live ENTRY is ENTRY, not PENDIENTE", () => {
    const card = historyCardModel(row({ outcome: "pending", hadV1Entry: true }));
    assert.equal(card.outcome, "ENTRY");
    assert.equal(card.episodeState, "ENTRY");
    assert.equal(card.hadV1Entry, true);
    assert.equal(card.entryV1Label, "SÍ");
  });

  it("MAPA wick TP1 stays MAPA and is not a V1 trade", () => {
    const card = historyCardModel(
      row({
        episode: episode({ openedState: "map", currentState: "map" }),
        outcome: "tp1",
        firstTouch: "tp1",
        firstTouchAtMs: Date.parse("2026-08-29T08:30:00Z"),
        hadV1Entry: false,
      }),
    );
    assert.equal(card.outcome, "toque técnico TP1");
    assert.equal(card.episodeState, "MAPA");
    assert.equal(card.hadV1Entry, false);
    assert.equal(card.entryV1Label, "NO");
    assert.equal(card.isTradeOutcome, false);
    assert.match(card.wick, /No hubo ENTRADA V1/);
    assert.match(card.setupCaption ?? "", /Setup sin ENTRADA V1 — toque técnico TP1/);
    assert.doesNotMatch(card.outcome, /^SL$|^TP1$|^TP2$|^ENTRY$/);
    assert.doesNotMatch(JSON.stringify(card), /ZONE_SWEEP|FVG_RETEST|BASELINE_V1|SHADOW/i);
  });

  it("MAP SL is a technical touch, never Operación SL", () => {
    const mapSl = row({
      episode: episode({ openedState: "map", currentState: "map" }),
      outcome: "sl",
      firstTouch: "sl",
      hadV1Entry: false,
    });
    const card = historyCardModel(mapSl);
    assert.equal(card.outcome, "toque técnico SL");
    assert.equal(card.isTradeOutcome, false);
    assert.equal(setupWithoutEntryLabel(mapSl), "Setup sin ENTRADA V1 — toque técnico SL");
    const buckets = historyBuckets([
      mapSl,
      row({ outcome: "tp1", hadV1Entry: true }),
    ]);
    assert.equal(buckets.operations.length, 1);
    assert.equal(buckets.setups.length, 1);
    assert.equal(buckets.operations[0]?.hadV1Entry, true);
    assert.equal(buckets.setups[0]?.hadV1Entry, false);
  });
});
