import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "../trading/types.ts";
import { foldEpisode } from "./episode.ts";
import { computePostEntryMetrics, v1EntryPrice } from "./post-entry.ts";
import { resolveOutcome } from "./outcome.ts";
import { createMemoryStore } from "./store-memory.ts";
import type { SetupProposal } from "../trading/types.ts";

function bar(time: number, o: number, h: number, l: number, c: number): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: 1 };
}

const sell = {
  direction: "sell" as const,
  sl: 100,
  tp1: 80,
  tp2: 70,
  zoneLow: 88,
  zoneHigh: 90,
  closedAtMs: null as number | null,
};

const setup: SetupProposal = {
  state: "entry",
  kind: "continuation",
  direction: "sell",
  zone: { low: 88, high: 90 },
  invalidation: 100,
  stopLoss: 100,
  takeProfit1: 80,
  takeProfit2: 70,
  riskReward: 2,
  quality: "media",
  qualityPhase: "final",
  supersedeLevel: null,
  missingForEntry: null,
  slWide: false,
  warnings: [],
  managementNote: "",
  entryLabel: "",
};

describe("post-entry metrics", () => {
  it("A: no ENTRY event → no post-entry row", async () => {
    const store = createMemoryStore();
    const folded = foldEpisode(
      null,
      { id: "XAUUSD", setupState: "map", setup: { ...setup, state: "map", missingForEntry: "Falta: salida 15M de la zona a favor." }, waitReason: null, digits: 2 },
      1_000,
      1_000_000,
    );
    await store.upsertEpisode(folded.episode!);
    for (const ev of folded.events) await store.insertEvent(ev);
    assert.equal(await store.findEntryEvent(folded.episode!.episodeId), null);
    await store.upsertOutcome(folded.episode!.episodeId, 1, {
      rule: "m15-wick-first-touch-sl-wins-same-bar",
      outcome: "sl",
      firstTouch: "sl",
      firstTouchAtSec: 1_000,
      exitAtSec: 1_000,
      mfe: 1,
      mae: 2,
    });
    assert.equal((await store.getOutcomeDetails(folded.episode!.episodeId))?.postEntry, undefined);
  });

  it("B: ENTRY event supplies entryAtMs and entrySlot", async () => {
    const store = createMemoryStore();
    const folded = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null, digits: 2 },
      5_000,
      9_000_000,
    );
    await store.upsertEpisode(folded.episode!);
    for (const ev of folded.events) await store.insertEvent(ev);
    const entry = await store.findEntryEvent(folded.episode!.episodeId);
    assert.ok(entry);
    assert.equal(entry!.toState, "entry");
    assert.equal(entry!.slot, 5_000);
    assert.equal(entry!.atMs, 9_000_000);
    const metrics = computePostEntryMetrics(folded.episode!, entry!, []);
    assert.equal(metrics.entrySlot, 5_000);
    assert.equal(metrics.entryAtMs, 9_000_000);
    assert.equal(metrics.entryPrice, v1EntryPrice("sell", 88, 90));
    assert.equal(metrics.entryPrice, 88);
  });

  it("C: MFE/MAE ignore bars before entrySlot", () => {
    const entry = { atMs: 2_000_000, slot: 2_000 };
    const candles = [
      bar(1_000, 90, 110, 70, 90),
      bar(2_000, 90, 91, 89, 90),
      bar(2_900, 90, 91, 85, 88),
    ];
    const fromOpen = resolveOutcome({ ...sell, openedSlot: 1_000, closed: false, candles });
    const fromEntry = computePostEntryMetrics(sell, entry, candles);
    assert.equal(fromOpen.outcome, "sl");
    assert.equal(fromEntry.firstTouch, null);
    assert.ok((fromEntry.mfe ?? 0) < 20);
    assert.ok((fromOpen.mae ?? 0) >= 10);
  });

  it("D: no look-ahead — future bars after a later slot are not used when entry is later", () => {
    const entry = { atMs: 3_000_000, slot: 3_000 };
    const candles = [
      bar(1_000, 90, 91, 79, 85),
      bar(3_000, 90, 91, 89, 90),
    ];
    const pe = computePostEntryMetrics(sell, entry, candles);
    assert.equal(pe.outcome, "pending");
    assert.equal(pe.firstTouch, null);
  });

  it("same-bar SL/TP after entry still prefers SL", () => {
    const entry = { atMs: 2_000_000, slot: 2_000 };
    const pe = computePostEntryMetrics(sell, entry, [bar(2_000, 90, 101, 79, 85)]);
    assert.equal(pe.outcome, "sl");
  });
});
