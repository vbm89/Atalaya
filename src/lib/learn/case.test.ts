import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetAnalysis, SetupProposal } from "../trading/types.ts";
import type { EpisodeDraft } from "../watch/episode.ts";
import { freezeFromAnalysis, freezeField, type EpisodeFreeze } from "../watch/freeze.ts";
import type { HistoryRow } from "../watch/store.ts";
import {
  learningCaseFromHistory,
  learningCasesFromHistory,
  levelsIncoherent,
  timestampsInvalid,
} from "./case.ts";
import { summarize } from "./stats.ts";

function setup(partial: Partial<SetupProposal> = {}): SetupProposal {
  return {
    state: "entry",
    kind: "continuation",
    direction: "sell",
    zone: { low: 77500, high: 77600 },
    invalidation: 77964,
    stopLoss: 78150,
    takeProfit1: 77100,
    takeProfit2: 76800,
    riskReward: 2.1,
    quality: "alta",
    qualityPhase: "final",
    supersedeLevel: null,
    missingForEntry: null,
    slWide: false,
    warnings: ["SL amplio"],
    managementNote: "",
    entryLabel: "",
    ...partial,
  };
}

function analysis(partial: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    id: "BTCUSD",
    label: "BTCUSD",
    name: "Bitcoin",
    sourceNote: "",
    dataSource: "binance",
    venue: "Binance",
    feedSymbol: "BTCUSDT",
    instrumentKind: "proxy",
    dataStatus: "ok",
    dataStatusLabel: "ok",
    lastDataAt: null,
    availableTimeframes: ["15m", "1h", "4h"],
    quality: "live",
    qualityNote: "",
    price: 77552,
    priceSpot: null,
    priceProxy: 77552,
    basis: null,
    basisPct: null,
    spotSource: null,
    proxySource: "binance",
    spotStatus: null,
    dayChangePct: 0,
    marketTime: null,
    sparkline: [],
    trend: "bajista",
    volatility: "media",
    atrPct: 0.4,
    signal: "sell",
    setupState: "entry",
    setup: setup(),
    technicalSummary: "",
    supports: [],
    resistances: [],
    timeframes: [
      {
        timeframe: "15m",
        barCount: 40,
        trend: "bajista",
        structure: "bajista",
        indicators: {
          ema20: null, ema50: null, ema200: null, rsi: null, macd: null,
          macdSignal: null, macdHist: null, atr: null, atrPct: null,
          volumeRatio: 1.7, volumeAvailable: true,
        },
        levels: { supports: [], resistances: [] },
        score: 0, notes: [], sufficient: true, source: "binance",
        lastBarAt: null, stale: false, ageMinutes: 1,
      },
      {
        timeframe: "4h",
        barCount: 40,
        trend: "bajista",
        structure: "bajista",
        indicators: {
          ema20: null, ema50: null, ema200: null, rsi: null, macd: null,
          macdSignal: null, macdHist: null, atr: null, atrPct: null,
          volumeRatio: 0.9, volumeAvailable: true,
        },
        levels: { supports: [], resistances: [] },
        score: 0, notes: [], sufficient: true, source: "binance",
        lastBarAt: null, stale: false, ageMinutes: 1,
      },
    ],
    news: [],
    entry: null,
    waitReason: null,
    wouldTrade: "wait",
    wouldTradeReason: "análisis",
    confidence: 0,
    digits: 2,
    bias4hLabel: "BAJISTA LOCAL · BOS",
    ...partial,
  };
}

const OLD_FREEZE: EpisodeFreeze = {
  slotClosePrice: 77552,
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
  capturedAtMs: 1_000,
};

const SLOT = 1_788_271_200;
const OPENED_AT = SLOT * 1000 + 8_000;
const CLOSED_AT = SLOT * 1000 + 3_600_000;
const TOUCH_SAME = SLOT * 1000;
const TOUCH_LATER = (SLOT + 900) * 1000;
const TOUCH_PREV = (SLOT - 900) * 1000;

function episode(partial: Partial<EpisodeDraft> = {}): EpisodeDraft {
  return {
    episodeId: "BTCUSD-e1",
    assetId: "BTCUSD",
    direction: "sell",
    kind: "continuation",
    zoneLow: 77500,
    zoneHigh: 77600,
    sl: 78150,
    tp1: 77100,
    tp2: 76800,
    openedAtMs: OPENED_AT,
    openedState: "entry",
    currentState: "entry",
    closedAtMs: CLOSED_AT,
    levelsKey: "k",
    openedSlot: SLOT,
    freeze: OLD_FREEZE,
    ...partial,
  };
}

function row(partial: Partial<HistoryRow> = {}, ep: Partial<EpisodeDraft> = {}): HistoryRow {
  return {
    episode: episode(ep),
    outcome: "tp1",
    firstTouch: "tp1",
    firstTouchAtMs: TOUCH_LATER,
    mfe: 400,
    mae: 20,
    ...partial,
  };
}

describe("P5.2 freeze enriquecido", () => {
  it("copies V1 outputs and does not invent missing volume", () => {
    const f = freezeFromAnalysis(analysis(), 50);
    assert.equal(f.bias4hLabel, "BAJISTA LOCAL · BOS");
    assert.equal(f.missingForEntry, null);
    assert.deepEqual(f.warnings, ["SL amplio"]);
    assert.equal(f.qualityPhase, "final");
    assert.equal(f.volumeRatio15, 1.7);
    assert.equal(f.volumeRatio4h, 0.9);
    assert.equal(f.invalidation, 77964);
    assert.equal(f.setupState, "entry");
    assert.equal(f.direction, "sell");
    assert.equal(f.timeframe, "15m");
    assert.equal(f.riskReward, 2.1);
  });

  it("keeps pre-P5.2 freeze fields and treats new keys as unavailable", () => {
    assert.equal(OLD_FREEZE.quality, "media");
    assert.equal(freezeField(OLD_FREEZE.bias4hLabel), null);
    assert.equal(freezeField(OLD_FREEZE.volumeRatio15), null);
    assert.equal(freezeField(OLD_FREEZE.invalidation), null);
  });
});

describe("P5.2 learning case", () => {
  it("complete new freeze + TP1 → trainable", () => {
    const f = freezeFromAnalysis(analysis(), 1_000);
    const c = learningCaseFromHistory(row({ outcome: "tp1", firstTouch: "tp1" }, { freeze: f }));
    assert.equal(c.trainable, true);
    assert.equal(c.exclusionReason, null);
    assert.equal(c.outcome, "tp1");
    assert.equal(c.entry, 77500);
    assert.equal(c.bias4hLabel, "BAJISTA LOCAL · BOS");
    assert.equal(c.complete, true);
  });

  it("outcome pending → not trainable", () => {
    const f = freezeFromAnalysis(analysis(), 1_000);
    const c = learningCaseFromHistory(row({ outcome: "pending", firstTouch: null }, { freeze: f, closedAtMs: null }));
    assert.equal(c.trainable, false);
    assert.equal(c.exclusionReason, "OUTCOME_PENDING");
  });

  it("data error → not trainable", () => {
    const f = freezeFromAnalysis(analysis({ dataStatus: "error", dataStatusLabel: "fail" }), 1_000);
    const c = learningCaseFromHistory(row({ outcome: "tp1" }, { freeze: f }));
    assert.equal(c.trainable, false);
    assert.equal(c.exclusionReason, "DATA_INVALID");
  });

  it("incoherent levels → not trainable", () => {
    const f = freezeFromAnalysis(analysis(), 1_000);
    const ep = episode({ freeze: f, sl: 77000, tp1: 79000, direction: "sell" });
    assert.equal(levelsIncoherent(ep), true);
    const c = learningCaseFromHistory(row({ outcome: "sl" }, ep));
    assert.equal(c.trainable, false);
    assert.equal(c.exclusionReason, "LEVELS_INCOHERENT");
  });

  it("impossible timestamp → not trainable", () => {
    const f = freezeFromAnalysis(analysis(), OPENED_AT);
    const c = learningCaseFromHistory(
      row({ outcome: "tp1", firstTouchAtMs: TOUCH_PREV }, { freeze: f }),
    );
    assert.equal(c.trainable, false);
    assert.equal(c.exclusionReason, "TIMESTAMP_INVALID");
  });

  it("old episode missing fields → null, not reconstructed from live", () => {
    const live = freezeFromAnalysis(analysis(), 99_000);
    const c = learningCaseFromHistory(row({ outcome: "expired", firstTouch: null }, { freeze: OLD_FREEZE }));
    assert.equal(c.bias4hLabel, null);
    assert.equal(c.volumeRatio15, null);
    assert.equal(c.invalidation, null);
    assert.notEqual(c.bias4hLabel, live.bias4hLabel);
    assert.equal(c.outcome, "expired");
    assert.equal(c.trainable, true);
    assert.equal(c.complete, false);
  });

  it("keeps TP1 TP2 SL EXPIRADA labels", () => {
    const f = freezeFromAnalysis(analysis(), 1_000);
    assert.equal(learningCaseFromHistory(row({ outcome: "tp1" }, { freeze: f })).outcome, "tp1");
    assert.equal(learningCaseFromHistory(row({ outcome: "tp2" }, { freeze: f })).outcome, "tp2");
    assert.equal(learningCaseFromHistory(row({ outcome: "sl" }, { freeze: f })).outcome, "sl");
    assert.equal(learningCaseFromHistory(row({ outcome: "expired", firstTouch: null }, { freeze: f })).outcome, "expired");
  });

  it("missing freeze → not trainable", () => {
    const c = learningCaseFromHistory(row({ outcome: "tp1" }, { freeze: null }));
    assert.equal(c.trainable, false);
    assert.equal(c.exclusionReason, "FREEZE_MISSING");
  });

  it("duplicate episodeId yields one case", () => {
    const f = freezeFromAnalysis(analysis(), 1_000);
    const a = row({ outcome: "tp1" }, { freeze: f, episodeId: "same" });
    const b = row({ outcome: "sl" }, { freeze: f, episodeId: "same" });
    const list = learningCasesFromHistory([a, b]);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.outcome, "tp1");
  });
});

describe("P5 TIMESTAMP_INVALID uses openedSlot, not wall-clock openedAtMs", () => {
  function frozenRow(partial: Partial<HistoryRow> = {}, ep: Partial<EpisodeDraft> = {}): HistoryRow {
    const f = freezeFromAnalysis(analysis(), OPENED_AT);
    return row(partial, { freeze: f, ...ep });
  }

  it("same opening candle, firstTouch several seconds before openedAtMs → trainable", () => {
    assert.ok(TOUCH_SAME < OPENED_AT);
    const r = frozenRow({ outcome: "sl", firstTouch: "sl", firstTouchAtMs: TOUCH_SAME });
    assert.equal(timestampsInvalid(r), false);
    const c = learningCaseFromHistory(r);
    assert.equal(c.trainable, true);
    assert.equal(c.exclusionReason, null);
    assert.equal(c.outcome, "sl");
  });

  it("firstTouch exactly at openedAtMs → trainable", () => {
    const r = frozenRow({ outcome: "tp1", firstTouch: "tp1", firstTouchAtMs: OPENED_AT });
    assert.equal(timestampsInvalid(r), false);
    const c = learningCaseFromHistory(r);
    assert.equal(c.trainable, true);
    assert.equal(c.outcome, "tp1");
  });

  it("firstTouch on a later candle → trainable", () => {
    const r = frozenRow({ outcome: "tp1", firstTouch: "tp1", firstTouchAtMs: TOUCH_LATER });
    assert.equal(timestampsInvalid(r), false);
    const c = learningCaseFromHistory(r);
    assert.equal(c.trainable, true);
    assert.equal(c.outcome, "tp1");
  });

  it("firstTouch on a candle before openedSlot → TIMESTAMP_INVALID", () => {
    const r = frozenRow({ outcome: "tp1", firstTouch: "tp1", firstTouchAtMs: TOUCH_PREV });
    assert.equal(timestampsInvalid(r), true);
    const c = learningCaseFromHistory(r);
    assert.equal(c.trainable, false);
    assert.equal(c.exclusionReason, "TIMESTAMP_INVALID");
    assert.equal(c.outcome, "tp1");
  });

  it("EXPIRADA stays trainable and out of the decided denominator", () => {
    const exp = learningCaseFromHistory(
      frozenRow({ outcome: "expired", firstTouch: null, firstTouchAtMs: null, mfe: 0, mae: 0 }),
    );
    const tp1 = learningCaseFromHistory(frozenRow({ outcome: "tp1", firstTouch: "tp1" }));
    const sl = learningCaseFromHistory(
      frozenRow({ outcome: "sl", firstTouch: "sl" }, { episodeId: "BTCUSD-e2" }),
    );
    assert.equal(exp.trainable, true);
    assert.equal(exp.outcome, "expired");
    assert.equal(tp1.outcome, "tp1");
    assert.equal(sl.outcome, "sl");
    const stats = summarize([exp, tp1, sl]);
    assert.equal(stats.global.tp1, 1);
    assert.equal(stats.global.sl, 1);
    assert.equal(stats.global.expired, 1);
    assert.equal(stats.global.success.n, 2);
    assert.equal(stats.global.success.hits, 1);
  });
});
