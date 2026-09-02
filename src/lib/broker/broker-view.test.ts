import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  analysisDisclaimer,
  analysisPriceCaption,
  chartAnalysisCaption,
  emptyBrokerView,
  executionCostsLabel,
  executionRiskLabel,
  instrumentPair,
  isExecutionRiskCalculable,
  pushInstrumentLine,
  theoreticalRiskNote,
  viewsFromAsset,
  type AnalysisSource,
} from "./broker-view.ts";
import { shouldPushState } from "../watch/policy.ts";
import { buildPushPayload } from "../watch/payload.ts";
import { CHART_ASSET_BLURB } from "../chart/labels.ts";
import type { EpisodeDraft } from "../watch/episode.ts";

const V1 = {
  "src/lib/trading/engine.ts":
    "c3d53a4f4366add2c8a284d4f068ea5d2826a36e3aa259b460d74b37c36ce618",
  "src/lib/trading/signals.ts":
    "dfb2d2cd188b18daaebed5e843bd8dbefb1e1c6672be86d2092390a8b3bc019b",
  "src/lib/trading/structure.ts":
    "e72ba478f524170c7f6c1c6916e033c3fafb418b874aa33565e32dbd01b54170",
  "src/lib/trading/risk.ts":
    "4aa406c0061149486532e9f787d20c3cc9f845362dd5497fd42b42563b5d385e",
  "src/lib/watch/outcome.ts":
    "fdad185119978866d6bec772091e2d6d0d0af49a5207a7bae061d2d840453c90",
  "src/lib/market/xau-spot.ts":
    "393d01945077190a7745ad7cabc3b87bfb170f55fad82a4189a5ee661c678068",
} as const;

function wtiEntry(): AnalysisSource {
  return {
    id: "WTI",
    price: 89.5,
    feedSymbol: "CLUSDT",
    venue: "Bitget",
    dataSource: "Bitget CLUSDT",
    setupState: "entry",
    setup: {
      direction: "buy",
      zone: { low: 89.39, high: 89.64 },
      stopLoss: 89.39,
      takeProfit1: 91.05,
      takeProfit2: 92.22,
    },
  };
}

describe("V1 checksums — broker-view must not touch them", () => {
  for (const [file, expected] of Object.entries(V1)) {
    it(file, () => {
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
      assert.equal(hash, expected);
    });
  }
});

describe("instrument pair", () => {
  it("WTI analysis is CLUSDT, broker is WTICash, brokerPrice is null", () => {
    const p = instrumentPair("WTI");
    assert.equal(p.analysisInstrument, "CLUSDT");
    assert.equal(p.analysisProvider, "Bitget");
    assert.equal(p.brokerInstrument, "WTICash");
    assert.equal(p.brokerProvider, "T4Trade");
    const v = viewsFromAsset(wtiEntry());
    assert.equal(v.analysis.instrument, "CLUSDT");
    assert.equal(v.broker.instrument, "WTICash");
    assert.equal(v.broker.price, null);
    assert.equal(v.broker.mappingState, "FEED_NO_DISPONIBLE");
  });

  it("WTI brokerEntry is null and not the analysis entry", () => {
    const v = viewsFromAsset(wtiEntry());
    assert.equal(v.analysis.entry, 89.64);
    assert.equal(v.broker.entry, null);
    assert.notEqual(v.broker.entry, v.analysis.entry);
  });

  it("WTI broker SL/TP1/TP2 are null", () => {
    const v = viewsFromAsset(wtiEntry());
    assert.equal(v.broker.sl, null);
    assert.equal(v.broker.tp1, null);
    assert.equal(v.broker.tp2, null);
  });

  it("US100 analysis is NDX100USDT, broker is US100Cash", () => {
    const p = instrumentPair("US100");
    assert.equal(p.analysisInstrument, "NDX100USDT");
    assert.equal(p.brokerInstrument, "US100Cash");
    assert.notEqual(p.analysisInstrument, p.brokerInstrument);
    const v = viewsFromAsset({
      id: "US100",
      price: 23600,
      feedSymbol: "NDX100USDT",
      setupState: "entry",
      setup: {
        direction: "buy",
        zone: { low: 23500, high: 23600 },
        stopLoss: 23400,
        takeProfit1: 23800,
        takeProfit2: 23900,
      },
    });
    assert.equal(v.analysis.instrument, "NDX100USDT");
    assert.equal(v.broker.instrument, "US100Cash");
    assert.equal(v.broker.entry, null);
    assert.equal(v.broker.price, null);
  });

  it("BTC analysis is BTCUSDT, broker is BTCUSD — distinct instruments", () => {
    const p = instrumentPair("BTCUSD");
    assert.equal(p.analysisInstrument, "BTCUSDT");
    assert.equal(p.brokerInstrument, "BTCUSD");
    assert.notEqual(p.analysisInstrument, p.brokerInstrument);
    const v = viewsFromAsset({
      id: "BTCUSD",
      price: 77000,
      feedSymbol: "BTCUSDT",
      dataSource: "Binance BTCUSDT",
      setupState: "map",
      setup: null,
    });
    assert.equal(v.analysis.instrument, "BTCUSDT");
    assert.equal(v.broker.instrument, "BTCUSD");
    assert.equal(v.broker.price, null);
    assert.equal(v.broker.entry, null);
  });

  it("XAU analysis is SPOT XAUUSD and does not fill a T4Trade last", () => {
    const v = viewsFromAsset({
      id: "XAUUSD",
      price: 4343.5,
      priceSpot: 4343.5,
      feedSymbol: "XAUUSDT",
      setupState: "entry",
      setup: {
        direction: "sell",
        zone: { low: 4303.98, high: 4338.15 },
        stopLoss: 4339.89,
        takeProfit1: 4223.41,
        takeProfit2: 4170.69,
      },
    });
    assert.equal(v.analysis.instrument, "XAUUSD");
    assert.equal(v.analysis.kind, "spot");
    assert.equal(v.analysis.provider, "gold-api/OANDA");
    assert.equal(v.analysis.price, 4343.5);
    assert.equal(v.analysis.entry, 4303.98);
    assert.equal(v.broker.instrument, "XAUUSD");
    assert.equal(v.broker.price, null);
    assert.equal(v.broker.entry, null);
    assert.equal(v.broker.mappingState, "FEED_NO_DISPONIBLE");
  });
});

describe("phase 1 does not invent a basis", () => {
  it("WTI/US100/BTC broker view is empty — no offset, no mapped levels", () => {
    for (const id of ["WTI", "US100", "BTCUSD"] as const) {
      const b = emptyBrokerView(id);
      assert.equal(b.price, null);
      assert.equal(b.entry, null);
      assert.equal(b.sl, null);
      assert.equal(b.tp1, null);
      assert.equal(b.tp2, null);
      assert.equal(b.mappingState, "FEED_NO_DISPONIBLE");
      assert.equal(isExecutionRiskCalculable(b), false);
    }
  });

  it("does not copy analysisEntry into brokerEntry", () => {
    const v = viewsFromAsset(wtiEntry());
    assert.equal(v.analysis.entry, 89.64);
    assert.equal(v.broker.entry, null);
  });
});

describe("risk and costs honesty", () => {
  it("theoretical note exists; execution risk is NO CALCULABLE without broker levels", () => {
    assert.match(theoreticalRiskNote(), /teórica/i);
    assert.match(theoreticalRiskNote(), /No representa una orden ejecutable/);
    const exec = executionRiskLabel();
    assert.equal(exec.calculable, false);
    assert.equal(exec.label, "NO CALCULABLE");
    const v = viewsFromAsset(wtiEntry());
    assert.equal(isExecutionRiskCalculable(v.broker), false);
  });

  it("execution costs never use a proxy spread", () => {
    const c = executionCostsLabel();
    assert.equal(c.calculable, false);
    assert.equal(c.label, "NO CALCULABLE");
  });
});

describe("copy", () => {
  it("WTI disclaimer names CLUSDT and WTICash", () => {
    const t = analysisDisclaimer("WTI");
    assert.match(t, /CLUSDT/);
    assert.match(t, /WTICash/);
    assert.doesNotMatch(t, /compra WTICash a 89/i);
  });

  it("captions are explicit analysis instruments", () => {
    assert.match(analysisPriceCaption("WTI"), /CLUSDT/);
    assert.match(analysisPriceCaption("US100"), /NDX100USDT/);
    assert.equal(chartAnalysisCaption("WTI"), "ANÁLISIS · CLUSDT · BITGET · PROXY");
    assert.equal(chartAnalysisCaption("US100"), "ANÁLISIS · NDX100USDT · BITGET · PROXY");
    assert.equal(CHART_ASSET_BLURB.WTI, chartAnalysisCaption("WTI"));
    assert.equal(CHART_ASSET_BLURB.US100, chartAnalysisCaption("US100"));
  });
});

describe("push still only on ENTRADA and names the analysis instrument", () => {
  it("MAPA / PENDING / ESPERAR do not push", () => {
    assert.equal(shouldPushState("entry"), true);
    assert.equal(shouldPushState("pending"), false);
    assert.equal(shouldPushState("map"), false);
    assert.equal(shouldPushState("wait"), false);
  });

  it("WTI ENTRADA payload names PROXY CLUSDT and is not a T4Trade fill", () => {
    const ep: EpisodeDraft = {
      episodeId: "ep-wti",
      assetId: "WTI",
      direction: "buy",
      kind: "continuation",
      zoneLow: 89.39,
      zoneHigh: 89.64,
      sl: 89.39,
      tp1: 91.05,
      tp2: 92.22,
      openedAtMs: 1,
      openedState: "entry",
      currentState: "entry",
      closedAtMs: null,
      levelsKey: "k",
      openedSlot: 1,
      freeze: null,
    };
    const p = buildPushPayload(ep, "entry");
    assert.match(p.title, /WTI/);
    assert.match(p.title, /ENTRADA V1/);
    assert.match(p.body, /CLUSDT/);
    assert.match(p.body, /PROXY/);
    assert.match(p.body, /Entrada de análisis: 89,64/);
    assert.match(p.body, /SL de análisis: 89,39/);
    assert.match(p.body, /NO ES PRECIO DE EJECUCIÓN T4TRADE/i);
    assert.doesNotMatch(p.body, /TRIGGER PENDIENTE/);
    assert.equal(pushInstrumentLine("WTI", "COMPRA"), "COMPRA · CLUSDT · PROXY");
  });
});

describe("episodes keep V1 analysis levels", () => {
  it("broker-view does not rewrite 89.64 into a cash price", () => {
    const v = viewsFromAsset(wtiEntry());
    assert.equal(v.analysis.entry, 89.64);
    assert.equal(v.analysis.sl, 89.39);
    assert.equal(v.analysis.tp1, 91.05);
    assert.equal(v.analysis.tp2, 92.22);
    assert.equal(v.broker.entry, null);
  });
});
