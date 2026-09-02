import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EpisodeDraft } from "./episode.ts";
import type { EpisodeFreeze } from "./freeze.ts";
import type { HistoryRow } from "./store.ts";
import {
  HISTORY_DISCLAIMER,
  entryPrice,
  historyCardModel,
  kindLabel,
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
      }),
    );
    assert.equal(card.outcome, "TP1");
    assert.doesNotMatch(card.outcome, /WIN|LOSS|ganad|perdid/i);
    assert.doesNotMatch(card.wick, /WIN|LOSS/i);
    assert.equal(card.disclaimer, HISTORY_DISCLAIMER);
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
});
