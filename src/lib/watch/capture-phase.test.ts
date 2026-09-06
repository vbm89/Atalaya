import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captureEntryGates } from "./entry-gates.ts";
import { foldEpisode } from "./episode.ts";
import { freezeFromAnalysis, type EpisodeFreeze } from "./freeze.ts";
import { createMemoryStore } from "./store-memory.ts";
import { runWatchTick, type WatchLoad } from "./tick.ts";
import { slotOpenSec, slotSecFromNow } from "./identity.ts";
import type { AssetAnalysis, Candle, SetupProposal } from "../trading/types.ts";

const pendingMissing = "Falta: cierre 15M de fallo de aceptación o rechazo.";

const setup: SetupProposal = {
  state: "pending",
  kind: "continuation",
  direction: "sell",
  zone: { low: 88, high: 90 },
  invalidation: 100,
  stopLoss: 100,
  takeProfit1: 80,
  takeProfit2: 70,
  riskReward: 2,
  quality: "media",
  qualityPhase: "preliminar",
  supersedeLevel: null,
  missingForEntry: pendingMissing,
  slWide: false,
  warnings: [],
  managementNote: "",
  entryLabel: "",
};

function freezeAt(state: "map" | "pending" | "entry", extra: Partial<EpisodeFreeze> = {}): EpisodeFreeze {
  const missing = state === "pending" ? pendingMissing : state === "map" ? "Falta: salida 15M de la zona a favor." : null;
  return {
    slotClosePrice: 90,
    quality: "media",
    riskReward: 2,
    dataSource: "test",
    feedSymbol: "BTCUSDT",
    instrumentKind: "proxy",
    basis: null,
    dataStatus: "ok",
    waitReason: null,
    highImpact: false,
    underlyingClosed: false,
    timeframe: "15m",
    setupKind: "continuation",
    capturedAtMs: 1,
    missingForEntry: missing,
    setupState: state,
    direction: "sell",
    entryGates: captureEntryGates(state, missing) ?? null,
    ...extra,
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
    availableTimeframes: ["15m"],
    quality: "live",
    qualityNote: "",
    price: 90,
    priceSpot: null,
    priceProxy: 90,
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
    setupState: "pending",
    setup,
    technicalSummary: "",
    supports: [],
    resistances: [],
    timeframes: [],
    levels: [],
    calendar: [],
    waitReason: null,
    ...partial,
  } as AssetAnalysis;
}

describe("capture phase", () => {
  it("PENDING→ENTRY does not rewrite birth entryGates", async () => {
    const birthFreeze = freezeAt("pending");
    const born = foldEpisode(
      null,
      { id: "BTCUSD", setupState: "pending", setup, waitReason: null, digits: 2, freeze: birthFreeze },
      1_000,
      1_000_000,
    );
    assert.equal(born.episode?.freeze?.entryGates?.armed, true);
    assert.equal(born.episode?.freeze?.entryGates?.t2, false);
    assert.equal(born.episode?.freeze?.entryGates?.volume4h, null);

    const laterFreeze = freezeAt("entry", { capturedAtMs: 2 });
    const next = foldEpisode(
      born.episode,
      {
        id: "BTCUSD",
        setupState: "entry",
        setup: { ...setup, state: "entry", missingForEntry: null, qualityPhase: "final" },
        waitReason: null,
        digits: 2,
        freeze: laterFreeze,
      },
      1_900,
      1_900_000,
    );
    assert.equal(next.episode?.episodeId, born.episode?.episodeId);
    assert.equal(next.events.some((e) => e.toState === "entry"), true);
    assert.equal(next.episode?.freeze?.entryGates?.t2, false);
    assert.equal(next.episode?.freeze?.capturedAtMs, birthFreeze.capturedAtMs);
    assert.notEqual(next.episode?.freeze?.entryGates?.t2, laterFreeze.entryGates?.t2);

    const store = createMemoryStore();
    await store.upsertEpisode(born.episode!);
    await store.upsertEpisode({ ...next.episode!, freeze: laterFreeze });
    const loaded = await store.getEpisode(born.episode!.episodeId);
    assert.equal(loaded?.freeze?.entryGates?.t2, false);
    assert.equal(loaded?.freeze?.capturedAtMs, birthFreeze.capturedAtMs);
    assert.equal(loaded?.currentState, "entry");
  });

  it("MAP armed=false; volume4h can be null; underlyingClosed comes from V1 dataStatus", () => {
    const map = captureEntryGates("map", "Falta: salida 15M de la zona a favor.");
    assert.equal(map?.armed, false);
    assert.equal(map?.volume4h, null);
    const pending = captureEntryGates("pending", pendingMissing);
    assert.equal(pending?.armed, true);
    assert.equal(pending?.volume4h, null);
    const entry = captureEntryGates("entry", null);
    assert.equal(entry?.armed, true);
    assert.equal(entry?.volume4h, null);

    const open = freezeFromAnalysis(analysis({ dataStatus: "ok" }), 1);
    assert.equal(open.underlyingClosed, false);
    const closed = freezeFromAnalysis(analysis({ dataStatus: "session_closed" }), 1);
    assert.equal(closed.underlyingClosed, true);
    assert.equal(closed.entryGates?.underlyingClosed, pending?.underlyingClosed);
  });

  it("runWatchTick writes postEntry only when a real ENTRY event exists", async () => {
    function loadFor(now: number, state: "map" | "entry", s: SetupProposal): WatchLoad {
      const slot = slotSecFromNow(now);
      const covering: Candle = {
        time: slotOpenSec(slot),
        open: 90,
        high: 101,
        low: 79,
        close: 85,
        volume: 1,
      };
      return {
        assets: [
          {
            id: "BTCUSD",
            setupState: state,
            setup: s,
            waitReason: null,
            digits: 2,
            freeze: freezeAt(state),
          },
        ],
        m15ByAsset: { BTCUSD: [covering] },
        errors: [],
      };
    }

    const nowMs = Date.parse("2026-08-29T08:15:08.001Z");
    const mapStore = createMemoryStore();
    const mapTick = await runWatchTick({
      nowMs,
      store: mapStore,
      load: async () =>
        loadFor(nowMs, "map", {
          ...setup,
          state: "map",
          missingForEntry: "Falta: salida 15M de la zona a favor.",
        }),
    });
    assert.equal(mapTick.status, "ok");
    const mapId = mapTick.assets.find((a) => a.id === "BTCUSD")?.episodeId;
    assert.ok(mapId);
    assert.equal(await mapStore.findEntryEvent(mapId), null);
    const mapDetails = await mapStore.getOutcomeDetails(mapId);
    assert.equal(mapDetails?.postEntry, undefined);

    const entryNow = Date.parse("2026-08-29T08:30:08.001Z");
    const entryStore = createMemoryStore();
    const entryTick = await runWatchTick({
      nowMs: entryNow,
      store: entryStore,
      load: async () =>
        loadFor(entryNow, "entry", { ...setup, state: "entry", missingForEntry: null, qualityPhase: "final" }),
    });
    assert.equal(entryTick.status, "ok");
    const entryId = entryTick.assets.find((a) => a.id === "BTCUSD")?.episodeId;
    assert.ok(entryId);
    assert.ok(await entryStore.findEntryEvent(entryId));
    const details = await entryStore.getOutcomeDetails(entryId);
    assert.ok(details?.postEntry);
    const post = details!.postEntry as { entrySlot: number };
    assert.equal(typeof post.entrySlot, "number");
  });

  it("old freeze without entryGates remains loadable after upsert", async () => {
    const store = createMemoryStore();
    const { entryGates: _drop, ...legacy } = freezeAt("pending");
    const born = foldEpisode(
      null,
      { id: "XAUUSD", setupState: "pending", setup, waitReason: null, digits: 2, freeze: legacy },
      2_000,
      2_000_000,
    );
    await store.upsertEpisode(born.episode!);
    const loaded = await store.getEpisode(born.episode!.episodeId);
    assert.equal(loaded?.freeze?.entryGates, undefined);
    assert.ok(loaded?.freeze);
  });
});
