import test from "node:test";
import assert from "node:assert/strict";
import { forecastDay } from "./day-forecast.ts";
import type { AssetAnalysis } from "@/lib/trading/types";

function asset(trends: Record<string, "alcista" | "bajista" | "lateral">): AssetAnalysis {
  return {
    id: "BTCUSD",
    label: "BTCUSD",
    name: "Bitcoin",
    sourceNote: "test",
    dataSource: "test",
    venue: "test",
    feedSymbol: "BTCUSD",
    instrumentKind: "proxy",
    dataStatus: "ok",
    dataStatusLabel: "ok",
    lastDataAt: null,
    availableTimeframes: ["5m", "15m", "1h", "4h"],
    quality: "live",
    qualityNote: "test",
    price: 100,
    priceSpot: null,
    priceProxy: 100,
    basis: null,
    basisPct: null,
    spotSource: null,
    proxySource: "test",
    spotStatus: null,
    dayChangePct: 0,
    marketTime: null,
    sparkline: [],
    trend: "lateral",
    volatility: "media",
    atrPct: null,
    signal: "wait",
    setupState: "wait",
    setup: null,
    technicalSummary: "test",
    supports: [],
    resistances: [],
    timeframes: Object.entries(trends).map(([timeframe, trend]) => ({
      timeframe: timeframe as "5m" | "15m" | "1h" | "4h",
      barCount: 100,
      trend,
      structure: "test",
      indicators: {
        ema20: null, ema50: null, ema200: null, rsi: null, macd: null, macdSignal: null,
        macdHist: null, atr: null, atrPct: null, volumeRatio: null, volumeAvailable: false,
      },
      levels: { supports: [], resistances: [] },
      score: 0,
      notes: [],
      sufficient: true,
      source: "test",
      lastBarAt: null,
      stale: false,
      ageMinutes: 0,
    })),
    news: [],
    entry: null,
    waitReason: null,
    wouldTrade: "wait",
    wouldTradeReason: "test",
    confidence: 50,
    digits: 2,
    bias4hLabel: "test",
  };
}

test("daily forecast favors the dominant higher-timeframe bullish context", () => {
  const result = forecastDay(asset({ "4h": "alcista", "1h": "alcista", "15m": "alcista", "5m": "lateral" }));
  assert.equal(result.direction, "subir");
  assert.ok(result.confidence > 50);
});

test("daily forecast favors bearish context", () => {
  const result = forecastDay(asset({ "4h": "bajista", "1h": "bajista", "15m": "bajista", "5m": "lateral" }));
  assert.equal(result.direction, "bajar");
  assert.ok(result.confidence > 50);
});

test("daily forecast can remain neutral", () => {
  const result = forecastDay(asset({ "4h": "lateral", "1h": "lateral", "15m": "lateral", "5m": "lateral" }));
  assert.equal(result.direction, "neutro");
  assert.equal(result.confidence, 50);
});
