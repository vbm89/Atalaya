import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SETUP_CHART_TF,
  activeFrozenOverlay,
  activeStudyOverlay,
  chartIntentFromAnalysis,
  chartSetupLevels,
  chartSetupLevelsFromFrozen,
  frozenLevelsFromEpisode,
  frozenLevelsFromSetup,
  hasChartableSetup,
  setupLevelsKey,
  setupStateCaption,
  setupVisiblePriceRange,
  setupAutoscaleLocked,
  zoneBandAutoscaleRange,
  chartPriceLineSpecs,
  setupFillBands,
  interpolateTimeCoordinate,
  studyHorizonSec,
  studyStartCaption,
  studyStartClock,
  msToUnixSec,
} from "./setup-overlay.ts";
import { displayEntryPrice } from "./labels.ts";
import type { AssetAnalysis, SetupProposal } from "../trading/types.ts";

function setup(partial: Partial<SetupProposal> = {}): SetupProposal {
  return {
    state: "pending",
    kind: "break-retest",
    direction: "sell",
    zone: { low: 77800, high: 77900 },
    invalidation: 78150,
    stopLoss: 78150,
    takeProfit1: 77500,
    takeProfit2: 77100,
    riskReward: 1.8,
    quality: "media",
    qualityPhase: "preliminar",
    supersedeLevel: null,
    missingForEntry: "Falta: cierre 15M de fallo de aceptación o rechazo.",
    slWide: false,
    warnings: [],
    managementNote: "",
    entryLabel: "77800 · zona 77800 – 77900",
    ...partial,
  };
}

function asset(over: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    id: "BTCUSD",
    label: "BTCUSD",
    name: "Bitcoin",
    sourceNote: "",
    dataSource: "Binance",
    venue: "Binance",
    feedSymbol: "BTCUSDT",
    instrumentKind: "proxy",
    dataStatus: "ok",
    dataStatusLabel: "ok",
    lastDataAt: null,
    availableTimeframes: ["15m", "1h", "4h"],
    quality: "live",
    qualityNote: "",
    price: 77600,
    priceSpot: null,
    priceProxy: null,
    basis: null,
    basisPct: null,
    spotSource: null,
    proxySource: null,
    spotStatus: null,
    dayChangePct: 0,
    marketTime: null,
    sparkline: [],
    trend: "bajista",
    volatility: "media",
    atrPct: null,
    signal: "wait",
    setupState: "wait",
    setup: null,
    technicalSummary: "",
    supports: [],
    resistances: [],
    timeframes: [],
    news: [],
    entry: null,
    waitReason: "ESPERAR",
    wouldTrade: "no",
    wouldTradeReason: "",
    confidence: 0,
    digits: 2,
    bias4hLabel: "",
    ...over,
  };
}

describe("chart setup overlay", () => {
  it("V1 trigger TF is 15m", () => {
    assert.equal(SETUP_CHART_TF, "15m");
  });

  it("ESPERAR without setup is not chartable", () => {
    assert.equal(hasChartableSetup(asset()), false);
    assert.equal(chartSetupLevels(asset()), null);
  });

  it("frozen overlay (wait + setup) draws the frozen levels, not a new V1 signal", () => {
    const a = asset({
      setupState: "wait",
      waitReason: "Esta señal ya no está vigente.",
      setup: setup({ state: "entry" }),
    });
    assert.equal(hasChartableSetup(a), true);
    const lv = chartSetupLevels(a);
    assert.ok(lv);
    assert.equal(lv.state, "entry");
    assert.equal(lv.zoneLow, 77800);
    assert.equal(lv.stopLoss, 78150);
  });

  it("pending SHORT uses engine levels as-is", () => {
    const a = asset({
      setupState: "pending",
      setup: setup(),
      signal: "pending",
    });
    assert.equal(hasChartableSetup(a), true);
    const lv = chartSetupLevels(a);
    assert.ok(lv);
    assert.equal(lv.direction, "sell");
    assert.equal(lv.zoneLow, 77800);
    assert.equal(lv.zoneHigh, 77900);
    assert.equal(lv.entry, 77800);
    assert.equal(lv.stopLoss, 78150);
    assert.equal(lv.takeProfit1, 77500);
    assert.equal(lv.takeProfit2, 77100);
    assert.equal(setupStateCaption("pending"), "TRIGGER PENDIENTE — no es orden");
    const again = chartSetupLevels({ ...a, lastDataAt: "x" });
    assert.equal(setupLevelsKey(lv), setupLevelsKey(again));
  });

  it("autoscale ignores a far invalidation so the setup is not squashed", () => {
    const a = asset({
      setupState: "pending",
      setup: setup({ invalidation: 120000, stopLoss: 78150 }),
    });
    const lv = chartSetupLevels(a)!;
    const range = setupVisiblePriceRange(lv, 77850);
    assert.ok(range.max < 90000);
    assert.ok(range.min < lv.takeProfit2!);
    assert.ok(range.max > lv.stopLoss);
  });

  it("autoscale ignores a far last price so WTI/BTC are not squashed", () => {
    const a = asset({
      setupState: "pending",
      setup: setup({ invalidation: 78150, stopLoss: 78150 }),
    });
    const lv = chartSetupLevels(a)!;
    const range = setupVisiblePriceRange(lv, 120000);
    assert.ok(range.max < 90000);
    assert.ok(range.min < lv.takeProfit2!);
    assert.ok(range.max > lv.stopLoss);
  });

  it("setup never locks price autoscale (MAPA/PENDING must not freeze pinch)", () => {
    assert.equal(setupAutoscaleLocked("US100"), false);
    assert.equal(setupAutoscaleLocked("XAUUSD"), false);
    assert.equal(setupAutoscaleLocked("BTCUSD"), false);
    assert.equal(setupAutoscaleLocked("WTI"), false);
  });

  it("zone band can skip autoscale expansion so candles follow the visible range", () => {
    const extras = [28900, 29200, 28800];
    const locked = zoneBandAutoscaleRange(29020, 29050, extras, true);
    const free = zoneBandAutoscaleRange(29020, 29050, extras, false);
    assert.deepEqual(locked, { minValue: 28800, maxValue: 29200 });
    assert.equal(free, null);
  });

  it("price lines stay on V1 prices when last moves; no Last or Inv.", () => {
    const a = asset({
      setupState: "pending",
      setup: setup({
        direction: "sell",
        zone: { low: 29024, high: 29050 },
        stopLoss: 29088.81,
        takeProfit1: 28950,
        takeProfit2: 28880,
        invalidation: 29120,
      }),
    });
    const lv = chartSetupLevels(a)!;
    const lastA = chartPriceLineSpecs(lv);
    const lastB = chartPriceLineSpecs(lv);
    assert.deepEqual(
      lastA.map((s) => [s.id, s.price, s.title]),
      lastB.map((s) => [s.id, s.price, s.title]),
    );
    const sl = lastA.find((s) => s.id === "sl")!;
    const tp1 = lastA.find((s) => s.id === "tp1")!;
    const tp2 = lastA.find((s) => s.id === "tp2")!;
    const entry = lastA.find((s) => s.id === "entry")!;
    assert.equal(entry.price, 29024);
    assert.equal(entry.tone, "entry");
    assert.equal(sl.price, 29088.81);
    assert.equal(sl.tone, "sl");
    assert.equal(tp1.price, 28950);
    assert.equal(tp2.price, 28880);
    assert.equal(sl.title, "");
    assert.equal(
      lastA.some((s) => s.title.toLowerCase().includes("last") || s.title.includes("Inv")),
      false,
    );
    assert.equal(
      lastA.some((s) => s.price === lv.invalidation),
      false,
    );
  });

  it("sell fill is risk from entryPx to SL and reward from entryPx to TP", () => {
    const sell = chartSetupLevels(
      asset({
        setupState: "map",
        setup: setup({
          direction: "sell",
          zone: { low: 100, high: 110 },
          stopLoss: 120,
          takeProfit1: 90,
          takeProfit2: 80,
        }),
      }),
    )!;
    const buy = chartSetupLevels(
      asset({
        setupState: "map",
        setup: setup({
          direction: "buy",
          zone: { low: 100, high: 110 },
          stopLoss: 90,
          takeProfit1: 120,
          takeProfit2: 130,
        }),
      }),
    )!;
    const sellFills = setupFillBands(sell);
    const buyFills = setupFillBands(buy);
    const sellRisk = sellFills.find((b) => b.kind === "risk")!;
    const sellReward = sellFills.find((b) => b.kind === "reward")!;
    const buyRisk = buyFills.find((b) => b.kind === "risk")!;
    const buyReward = buyFills.find((b) => b.kind === "reward")!;
    assert.equal(sellRisk.high, 120);
    assert.equal(sellRisk.low, 100);
    assert.equal(sellReward.high, 100);
    assert.equal(sellReward.low, 80);
    assert.equal(buyRisk.low, 90);
    assert.equal(buyRisk.high, 110);
    assert.equal(buyReward.low, 110);
    assert.equal(buyReward.high, 130);
  });

  it("XAU SPOT levels are shifted by +basis onto PROXY candles", () => {
    const a = asset({
      id: "XAUUSD",
      digits: 2,
      setupState: "entry",
      basis: 8.9,
      setup: setup({
        direction: "buy",
        zone: { low: 4450, high: 4460 },
        stopLoss: 4440,
        takeProfit1: 4480,
        takeProfit2: 4500,
        invalidation: 4440,
      }),
    });
    const lv = chartSetupLevels(a);
    assert.ok(lv);
    assert.equal(lv.xauOnProxy, true);
    assert.equal(lv.zoneLow, 4458.9);
    assert.equal(lv.zoneHigh, 4468.9);
    assert.equal(lv.entry, 4468.9);
    assert.equal(lv.stopLoss, 4448.9);
    assert.ok(lv.labelZone.includes("4.450") || lv.labelZone.includes("4450"));
  });
});

describe("ChartIntent freeze", () => {
  it("VER GRÁFICO snapshots the setup; a later V1 print does not rewrite it", () => {
    const live = asset({ setupState: "entry", setup: setup({ state: "entry" }) });
    const intent = chartIntentFromAnalysis(live);
    assert.ok(intent);
    assert.equal(intent.tf, "15m");
    assert.equal(intent.freeze?.zoneLow, 77800);
    const later = asset({
      setupState: "entry",
      setup: setup({ state: "entry", zone: { low: 79000, high: 79100 }, stopLoss: 79500 }),
    });
    assert.notEqual(frozenLevelsFromSetup(later)?.zoneLow, intent.freeze?.zoneLow);
    const painted = chartSetupLevelsFromFrozen(intent.freeze!);
    assert.equal(painted.zoneLow, 77800);
    assert.equal(painted.stopLoss, 78150);
  });

  it("historical episode uses stored freeze levels and frozen XAU basis, not live basis", () => {
    const f = frozenLevelsFromEpisode(
      {
        episodeId: "ep-xau-1",
        assetId: "XAUUSD",
        live: false,
        state: "wait",
        direction: "buy",
        zoneLow: 4450,
        zoneHigh: 4460,
        sl: 4440,
        tp1: 4480,
        tp2: 4500,
        setup: setup({
          state: "entry",
          direction: "buy",
          zone: { low: 4450, high: 4460 },
          stopLoss: 4440,
          takeProfit1: 4480,
          takeProfit2: 4500,
          invalidation: 4440,
        }),
        freeze: {
          slotClosePrice: 4455,
          quality: "media",
          riskReward: 2,
          dataSource: "Bitget",
          feedSymbol: "XAUUSDT",
          instrumentKind: "proxy",
          basis: 8.9,
          dataStatus: "ok",
          waitReason: null,
          highImpact: false,
          underlyingClosed: false,
          timeframe: "15m",
          setupKind: "continuation",
          capturedAtMs: 1,
        },
      },
      2,
    );
    assert.ok(f);
    const lv = chartSetupLevelsFromFrozen(f);
    assert.equal(lv.zoneLow, 4458.9);
    assert.equal(lv.stopLoss, 4448.9);
    const liveBasisWouldBe = 1.2;
    assert.notEqual(f.basis, liveBasisWouldBe);
  });

  it("BTC M15 freeze is not drawn on BTC H1 or on XAU", () => {
    const freeze = frozenLevelsFromSetup(
      asset({ setupState: "pending", setup: setup() }),
    );
    assert.ok(freeze);
    assert.equal(activeFrozenOverlay(freeze, "BTCUSD", "15m")?.assetId, "BTCUSD");
    assert.equal(activeFrozenOverlay(freeze, "BTCUSD", "1h"), null);
    assert.equal(activeFrozenOverlay(freeze, "XAUUSD", "15m"), null);
    assert.equal(activeFrozenOverlay(freeze, "WTI", "15m"), null);
  });
});

describe("temporal study overlay", () => {
  it("interpolates 23:03 between 15m bars instead of snapping to a candle", () => {
    const t0 = 1_000;
    const t1 = 1_900;
    const x = interpolateTimeCoordinate(1_180, [
      { time: t0, x: 10 },
      { time: t1, x: 100 },
    ]);
    assert.ok(x != null);
    assert.equal(Math.round(x), 28);
  });

  it("extends the right edge past the last bar as time passes", () => {
    const x = interpolateTimeCoordinate(2_800, [
      { time: 1_000, x: 10 },
      { time: 1_900, x: 100 },
    ]);
    assert.ok(x != null);
    assert.ok(x > 100);
  });

  it("uses episode.openedAtMs, never openedSlot", () => {
    const openedAtMs = Date.parse("2026-09-01T21:03:00Z");
    const f = frozenLevelsFromEpisode(
      {
        episodeId: "ep-study-1",
        assetId: "US100",
        live: true,
        state: "map",
        direction: "sell",
        zoneLow: 4000,
        zoneHigh: 4005,
        sl: 4010,
        tp1: 3990,
        tp2: 3980,
        openedAtMs,
        closedAtMs: null,
        setup: setup({
          direction: "sell",
          zone: { low: 4000, high: 4005 },
          stopLoss: 4010,
          takeProfit1: 3990,
          takeProfit2: 3980,
        }),
      },
      2,
    );
    assert.ok(f);
    assert.equal(f.openedAtMs, openedAtMs);
    assert.equal(f.openedAtMs, Date.parse("2026-09-01T21:03:00Z"));
    const lv = chartSetupLevelsFromFrozen(f);
    assert.equal(lv.openedAtSec, Math.floor(openedAtMs / 1000));
    assert.equal(lv.studyLive, true);
    assert.equal(studyStartClock(openedAtMs), "23:03");
    assert.equal(studyStartCaption(openedAtMs), "Inicio de estudio · 23:03");
    const nowMs = Date.parse("2026-09-01T21:30:00Z");
    assert.equal(studyHorizonSec(lv, nowMs), nowMs / 1000);
    const sell = setupFillBands(lv);
    assert.equal(sell.find((b) => b.kind === "risk")?.low, 4000);
    assert.equal(sell.find((b) => b.kind === "risk")?.high, 4010);
    assert.equal(sell.find((b) => b.kind === "zone")?.low, 4000);
    assert.equal(sell.find((b) => b.kind === "zone")?.high, 4005);
    assert.equal(sell.find((b) => b.kind === "reward")?.high, 4000);
    assert.equal(sell.find((b) => b.kind === "reward")?.low, 3980);
  });

  it("buy geometry is SL below the zone and reward above", () => {
    const openedAtMs = Date.parse("2026-09-01T21:03:00Z");
    const lv = chartSetupLevels(
      asset({
        setupState: "map",
        setup: setup({
          direction: "buy",
          zone: { low: 4000, high: 4005 },
          stopLoss: 3990,
          takeProfit1: 4015,
          takeProfit2: 4025,
        }),
      }),
      { openedAtMs, closedAtMs: null },
    )!;
    const fills = setupFillBands(lv);
    assert.equal(fills.find((b) => b.kind === "risk")?.low, 3990);
    assert.equal(fills.find((b) => b.kind === "risk")?.high, 4005);
    assert.equal(fills.find((b) => b.kind === "reward")?.low, 4005);
    assert.equal(fills.find((b) => b.kind === "reward")?.high, 4025);
  });

  it("closed episode freezes the right edge at closedAt, not now", () => {
    const openedAtMs = Date.parse("2026-09-01T21:03:00Z");
    const closedAtMs = Date.parse("2026-09-01T21:45:00Z");
    const later = Date.parse("2026-09-01T22:10:00Z");
    const lv = chartSetupLevelsFromFrozen(
      frozenLevelsFromEpisode(
        {
          episodeId: "ep-closed",
          assetId: "BTCUSD",
          live: false,
          state: "wait",
          direction: "sell",
          zoneLow: 77800,
          zoneHigh: 77900,
          sl: 78150,
          tp1: 77500,
          tp2: 77100,
          openedAtMs,
          closedAtMs,
          setup: setup({ state: "entry" }),
        },
        2,
      )!,
    );
    assert.equal(lv.studyLive, false);
    assert.equal(studyHorizonSec(lv, later), closedAtMs / 1000);
  });

  it("stub capturedAtMs is not treated as a study start", () => {
    const f = frozenLevelsFromSetup(asset({ setupState: "pending", setup: setup() }));
    assert.equal(f?.openedAtMs, null);
    assert.equal(msToUnixSec(1), null);
    assert.equal(msToUnixSec(1_780_000_000), null);
  });

  it("study overlay follows the asset across TF; freeze overlay stays on the episode TF", () => {
    const freeze = frozenLevelsFromSetup(
      asset({ setupState: "pending", setup: setup() }),
      "live",
      { openedAtMs: Date.parse("2026-09-01T21:03:00Z"), closedAtMs: null },
    );
    assert.ok(freeze);
    assert.equal(activeStudyOverlay(freeze, "BTCUSD")?.assetId, "BTCUSD");
    assert.equal(activeStudyOverlay(freeze, "XAUUSD"), null);
    assert.equal(activeFrozenOverlay(freeze, "BTCUSD", "5m"), null);
  });

  it("levels key ignores the moving now, so ticks do not rebuild the overlay", () => {
    const clock = { openedAtMs: Date.parse("2026-09-01T21:03:00Z"), closedAtMs: null };
    const a = chartSetupLevels(asset({ setupState: "map", setup: setup() }), clock)!;
    const b = chartSetupLevels(asset({ setupState: "map", setup: setup(), lastDataAt: "later" }), clock)!;
    assert.equal(setupLevelsKey(a), setupLevelsKey(b));
    assert.notEqual(studyHorizonSec(a, clock.openedAtMs + 60_000), studyHorizonSec(a, clock.openedAtMs + 1_800_000));
  });
});

describe("UI entryPx is the single V1 reference, not a zone band", () => {
  it("SELL entry is zone.low — XAU 4303.98–4338.15 → 4303.98", () => {
    assert.equal(displayEntryPrice("sell", 4303.98, 4338.15), 4303.98);
    const lv = chartSetupLevels(
      asset({
        id: "XAUUSD",
        digits: 2,
        setupState: "pending",
        setup: setup({
          direction: "sell",
          zone: { low: 4303.98, high: 4338.15 },
          stopLoss: 4339.89,
          takeProfit1: 4223.41,
          takeProfit2: 4170.69,
        }),
      }),
    )!;
    assert.equal(lv.entry, 4303.98);
    assert.equal(lv.labelEntry, "4303,98");
    const lines = chartPriceLineSpecs(lv);
    assert.equal(lines.filter((s) => s.id === "entry").length, 1);
    assert.equal(lines.find((s) => s.id === "entry")?.price, 4303.98);
    assert.equal(lines.some((s) => s.id === "sl" && s.price === 4339.89), true);
    assert.equal(lines.some((s) => s.id === "tp1" && s.price === 4223.41), true);
    assert.equal(lines.some((s) => s.id === "tp2" && s.price === 4170.69), true);
    assert.equal(
      lines.some((s) => s.price === 4338.15 && s.id !== "entry"),
      false,
    );
  });

  it("BUY entry is zone.high", () => {
    assert.equal(displayEntryPrice("buy", 100, 110), 110);
    const lv = chartSetupLevels(
      asset({
        setupState: "map",
        setup: setup({
          direction: "buy",
          zone: { low: 100, high: 110 },
          stopLoss: 90,
          takeProfit1: 120,
          takeProfit2: 130,
        }),
      }),
    )!;
    assert.equal(lv.entry, 110);
    const lines = chartPriceLineSpecs(lv);
    assert.equal(lines.find((s) => s.id === "entry")?.price, 110);
    assert.equal(lines.length, 4);
  });
});
