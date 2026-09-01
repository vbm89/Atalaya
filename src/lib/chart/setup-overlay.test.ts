import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SETUP_CHART_TF,
  activeFrozenOverlay,
  chartIntentFromAnalysis,
  chartSetupLevels,
  chartSetupLevelsFromFrozen,
  frozenLevelsFromEpisode,
  frozenLevelsFromSetup,
  hasChartableSetup,
  setupLevelsKey,
  setupStateCaption,
  setupVisiblePriceRange,
} from "./setup-overlay.ts";
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
