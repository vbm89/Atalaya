import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "../trading/types.ts";
import { foldEpisode } from "./episode.ts";
import { computePostEntryMetrics, mergePostEntry, parsePostEntry, v1EntryPrice, type PostEntryMetrics } from "./post-entry.ts";
import { resolveOutcome } from "./outcome.ts";
import { createMemoryStore } from "./store-memory.ts";
import { slotOpenSec, slotSecFromNow } from "./identity.ts";
import { runWatchTick, type WatchLoad } from "./tick.ts";
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

function photo(partial: Partial<PostEntryMetrics> = {}): PostEntryMetrics {
  return {
    entryAtMs: 2_000_000,
    entrySlot: 2_000,
    entryPrice: 88,
    outcome: "pending",
    firstTouch: null,
    firstTouchAtSec: null,
    mfe: 1,
    mae: 2,
    ...partial,
  };
}

describe("post-entry merge is monotonic", () => {
  it("A: identity is write-once even if a later compute differs", () => {
    const first = mergePostEntry(null, photo());
    const second = mergePostEntry(
      first,
      photo({
        entryAtMs: 9_000_000,
        entrySlot: 9_000,
        entryPrice: 999,
        outcome: "pending",
      }),
    );
    assert.equal(second.entryAtMs, 2_000_000);
    assert.equal(second.entrySlot, 2_000);
    assert.equal(second.entryPrice, 88);
  });

  it("B: firstTouch survives a later window that lost the touch bar", () => {
    const first = mergePostEntry(null, photo({ outcome: "sl", firstTouch: "sl", firstTouchAtSec: 2_000, mfe: 4, mae: 10 }));
    const second = mergePostEntry(first, photo({ outcome: "pending", firstTouch: null, firstTouchAtSec: null, mfe: 0, mae: 0 }));
    assert.equal(second.firstTouch, "sl");
    assert.equal(second.firstTouchAtSec, 2_000);
    assert.equal(second.outcome, "sl");
  });

  it("C: outcome=sl cannot return to pending when the SL bar is gone", () => {
    const first = mergePostEntry(null, photo({ outcome: "sl", firstTouch: "sl", firstTouchAtSec: 2_900 }));
    const lost = computePostEntryMetrics(sell, { atMs: 2_000_000, slot: 2_000 }, [bar(5_000, 90, 91, 89, 90)]);
    assert.equal(lost.outcome, "pending");
    const second = mergePostEntry(first, lost);
    assert.equal(second.outcome, "sl");
    assert.equal(second.firstTouch, "sl");
  });

  it("D: tp1, tp2 and expired are also terminal", () => {
    for (const terminal of ["tp1", "tp2", "expired"] as const) {
      const first = mergePostEntry(
        null,
        photo({
          outcome: terminal,
          firstTouch: terminal === "expired" ? null : terminal,
          firstTouchAtSec: terminal === "expired" ? null : 2_000,
        }),
      );
      const second = mergePostEntry(first, photo({ outcome: "pending", firstTouch: "sl", firstTouchAtSec: 4_000 }));
      assert.equal(second.outcome, terminal, terminal);
      assert.equal(second.firstTouch, terminal === "expired" ? null : terminal, terminal);
    }
  });

  it("E: MFE/MAE may rise while pending and must not fall if the window shrinks", () => {
    const a = mergePostEntry(null, photo({ mfe: 3, mae: 4, outcome: "pending" }));
    const b = mergePostEntry(a, photo({ mfe: 5, mae: 7, outcome: "pending" }));
    assert.equal(b.mfe, 5);
    assert.equal(b.mae, 7);
    const c = mergePostEntry(b, photo({ mfe: 1, mae: 0, outcome: "pending" }));
    assert.equal(c.mfe, 5);
    assert.equal(c.mae, 7);
    const d = mergePostEntry(c, photo({ mfe: null, mae: null, outcome: "pending" }));
    assert.equal(d.mfe, 5);
    assert.equal(d.mae, 7);
  });

  it("F: MAP/PENDING still do not create postEntry", async () => {
    async function tickState(state: "map" | "pending") {
      const store = createMemoryStore();
      const nowMs = Date.parse("2026-08-29T08:15:08.001Z");
      const slot = slotSecFromNow(nowMs);
      const missing =
        state === "map"
          ? "Falta: salida 15M de la zona a favor."
          : "Falta: cierre 15M de fallo de aceptación o rechazo.";
      const result = await runWatchTick({
        nowMs,
        store,
        load: async () => ({
          assets: [
            {
              id: "BTCUSD",
              setupState: state,
              setup: { ...setup, state, missingForEntry: missing },
              waitReason: null,
              digits: 2,
            },
          ],
          m15ByAsset: {
            BTCUSD: [{ time: slotOpenSec(slot), open: 90, high: 101, low: 79, close: 85, volume: 1 }],
          },
          errors: [],
        }),
      });
      assert.equal(result.status, "ok");
      const id = result.assets.find((a) => a.id === "BTCUSD")?.episodeId;
      assert.ok(id);
      assert.equal(await store.findEntryEvent(id), null);
      assert.equal((await store.getOutcomeDetails(id))?.postEntry, undefined);
    }
    await tickState("map");
    await tickState("pending");
  });

  it("H: a later hypothetical ENTRY event cannot replace identity", () => {
    const first = mergePostEntry(null, photo({ entryAtMs: 2_000_000, entrySlot: 2_000, entryPrice: 88 }));
    const laterEvent = mergePostEntry(
      first,
      photo({ entryAtMs: 8_000_000, entrySlot: 8_000, entryPrice: 70, outcome: "tp1", firstTouch: "tp1", firstTouchAtSec: 8_000 }),
    );
    assert.equal(laterEvent.entryAtMs, 2_000_000);
    assert.equal(laterEvent.entrySlot, 2_000);
    assert.equal(laterEvent.entryPrice, 88);
  });

  it("I: firstTouch before entrySlot is rejected", () => {
    const first = mergePostEntry(
      null,
      photo({ outcome: "sl", firstTouch: "sl", firstTouchAtSec: 1_000, entrySlot: 2_000 }),
    );
    assert.equal(first.firstTouch, null);
    assert.equal(first.outcome, "pending");
    const kept = mergePostEntry(photo({ outcome: "pending" }), photo({ outcome: "tp1", firstTouch: "tp1", firstTouchAtSec: 500 }));
    assert.equal(kept.firstTouch, null);
    assert.equal(kept.outcome, "pending");
  });

  it("parsePostEntry does not invent identity from junk", () => {
    assert.equal(parsePostEntry(null), null);
    assert.equal(parsePostEntry({ outcome: "sl" }), null);
    assert.equal(parsePostEntry({ entryAtMs: 1, entrySlot: 1, entryPrice: 88 })?.entryPrice, 88);
  });
});

describe("post-entry tick persistence", () => {
  it("B/C: a later tick that lost the SL bar keeps postEntry.outcome=sl", async () => {
    const store = createMemoryStore();
    const now1 = Date.parse("2026-08-29T08:15:08.001Z");
    const now2 = Date.parse("2026-08-29T08:30:08.001Z");

    function loadAt(now: number, bars: Candle[]): WatchLoad {
      const slot = slotSecFromNow(now);
      const covering: Candle = {
        time: slotOpenSec(slot),
        open: 90,
        high: 91,
        low: 89,
        close: 90,
        volume: 1,
      };
      return {
        assets: [
          {
            id: "BTCUSD",
            setupState: "entry",
            setup,
            waitReason: null,
            digits: 2,
          },
        ],
        m15ByAsset: { BTCUSD: [covering, ...bars] },
        errors: [],
      };
    }

    const slot1 = slotSecFromNow(now1);
    const slBar: Candle = { time: slot1, open: 90, high: 101, low: 89, close: 95, volume: 1 };
    const first = await runWatchTick({
      nowMs: now1,
      store,
      load: async () => loadAt(now1, [slBar]),
    });
    assert.equal(first.status, "ok");
    const id = first.assets.find((a) => a.id === "BTCUSD")?.episodeId;
    assert.ok(id);
    const afterFirst = (await store.getOutcomeDetails(id))?.postEntry as PostEntryMetrics;
    assert.equal(afterFirst.outcome, "sl");
    assert.equal(afterFirst.firstTouch, "sl");
    const identity = {
      entryAtMs: afterFirst.entryAtMs,
      entrySlot: afterFirst.entrySlot,
      entryPrice: afterFirst.entryPrice,
    };

    const later = await runWatchTick({
      nowMs: now2,
      store,
      load: async () => loadAt(now2, [{ time: slotSecFromNow(now2), open: 90, high: 91, low: 89, close: 90, volume: 1 }]),
    });
    assert.equal(later.status, "ok");
    const afterSecond = (await store.getOutcomeDetails(id))?.postEntry as PostEntryMetrics;
    assert.equal(afterSecond.outcome, "sl");
    assert.equal(afterSecond.firstTouch, "sl");
    assert.equal(afterSecond.entryAtMs, identity.entryAtMs);
    assert.equal(afterSecond.entrySlot, identity.entrySlot);
    assert.equal(afterSecond.entryPrice, identity.entryPrice);
  });
});
