import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetAnalysis, SetupProposal, SetupState } from "../trading/types.ts";
import type { EpisodeDraft } from "../watch/episode.ts";
import type { EpisodeFreeze } from "../watch/freeze.ts";
import type { HistoryRow } from "../watch/store.ts";
import {
  EXPLAIN_DISCLAIMER,
  PENDING_HISTORY,
  WAIT_GUIDES,
  classifyWaitReason,
  explain,
  explainFromAnalysis,
  explainFromHistory,
  missingParts,
  type ExplainInput,
} from "./explain.ts";
import { GLOSSARY, GLOSSARY_IDS } from "./glossary.ts";

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
    warnings: [],
    managementNote: "",
    entryLabel: "77500 · zona 77500 – 77600",
    ...partial,
  };
}

function base(partial: Partial<ExplainInput> = {}): ExplainInput {
  return {
    source: "live",
    id: "BTCUSD",
    setupState: "wait",
    waitReason: "ESPERAR — no hay BOS 4H por cierre.",
    missingForEntry: null,
    warnings: [],
    bias4hLabel: "LATERAL",
    setup: null,
    digits: 0,
    volumeRatio15: null,
    volumeAvailable: true,
    highImpact: false,
    underlyingClosed: false,
    dataStatus: "ok",
    ...partial,
  };
}

function analysis(partial: Partial<AssetAnalysis> & { setupState: SetupState }): AssetAnalysis {
  return {
    id: "XAUUSD",
    label: "XAUUSD",
    name: "Oro",
    sourceNote: "",
    dataSource: "bitget",
    venue: "bitget",
    feedSymbol: "XAUUSDT",
    instrumentKind: "proxy",
    dataStatus: "ok",
    dataStatusLabel: "ok",
    lastDataAt: null,
    availableTimeframes: ["15m", "1h", "4h"],
    quality: "live",
    qualityNote: "",
    price: 2650,
    priceSpot: 2650,
    priceProxy: 2654,
    basis: 4,
    basisPct: 0.15,
    spotSource: "gold-api",
    proxySource: "bitget",
    spotStatus: "ok",
    dayChangePct: 0,
    marketTime: null,
    sparkline: [],
    trend: "alcista",
    volatility: "media",
    atrPct: 0.4,
    signal: partial.setupState === "wait" ? "wait" : partial.setup?.direction ?? "buy",
    setup: null,
    technicalSummary: "resumen",
    supports: [],
    resistances: [],
    timeframes: [
      {
        timeframe: "15m",
        barCount: 50,
        trend: "alcista",
        structure: "alcista",
        indicators: {
          ema20: null,
          ema50: null,
          ema200: null,
          rsi: null,
          macd: null,
          macdSignal: null,
          macdHist: null,
          atr: null,
          atrPct: null,
          volumeRatio: 1.6,
          volumeAvailable: true,
        },
        levels: { supports: [], resistances: [] },
        score: 0,
        notes: [],
        sufficient: true,
        source: "bitget",
        lastBarAt: null,
        stale: false,
        ageMinutes: 1,
      },
    ],
    news: [],
    entry: null,
    waitReason: null,
    wouldTrade: "wait",
    wouldTradeReason: "ESPERAR",
    confidence: 0,
    digits: 2,
    bias4hLabel: "ALCISTA LOCAL · BOS",
    ...partial,
  };
}

describe("P5.1 explain WAIT", () => {
  it("WAIT produces a clear explanation and marks BOS as fail", () => {
    const view = explain(base());
    assert.equal(view.state, "wait");
    assert.equal(view.stateLabel, "ESPERAR");
    assert.match(view.headline, /Todavía no hay entrada/);
    assert.match(view.motive, /BOS 4H/);
    const bos = view.checks.find((c) => c.id === "bos");
    assert.equal(bos?.status, "fail");
    const zona = view.checks.find((c) => c.id === "origen");
    assert.equal(zona?.status, "na");
    const trigger = view.checks.find((c) => c.id === "trigger");
    assert.equal(trigger?.status, "na");
    assert.equal(view.levels, null);
  });

  it("every known waitReason has a guide and never disappears", () => {
    for (const g of WAIT_GUIDES) {
      const hit = classifyWaitReason(g.sample);
      assert.equal(hit?.id, g.id, g.sample);
      const view = explain(base({ waitReason: g.sample, setupState: "wait", setup: null }));
      assert.equal(view.state, "wait");
      assert.ok(view.motive.length > 0);
      assert.equal(view.unmappedReasons.length, 0, g.sample);
    }
  });

  it("unknown waitReason is surfaced, not dropped", () => {
    const reason = "ESPERAR — unicornio del motor.";
    const view = explain(base({ waitReason: reason }));
    assert.equal(view.state, "wait");
    assert.ok(view.unmappedReasons.includes(reason));
    assert.ok(view.extras.some((e) => e.includes("unicornio")));
    assert.equal(classifyWaitReason(reason), null);
  });
});

describe("P5.1 explain MAPA", () => {
  it("MAPA shows zone and missing exit, not ENTRY", () => {
    const s = setup({
      state: "map",
      qualityPhase: "preliminar",
      missingForEntry: "Falta: salida 15M de la zona a favor.",
    });
    const view = explain(
      base({
        setupState: "map",
        waitReason: null,
        missingForEntry: s.missingForEntry,
        setup: s,
        bias4hLabel: "BAJISTA LOCAL · BOS",
      }),
    );
    assert.equal(view.state, "map");
    assert.equal(view.stateLabel, "MAPA");
    assert.match(view.headline, /zona potencial/i);
    assert.equal(view.checks.find((c) => c.id === "bos")?.status, "ok");
    assert.equal(view.checks.find((c) => c.id === "retorno")?.status, "fail");
    assert.equal(view.checks.find((c) => c.id === "trigger")?.status, "na");
    assert.ok(view.levels);
    assert.match(view.levels!.rr, /2\.1/);
    assert.doesNotMatch(view.headline, /ENTRADA/);
  });
});

describe("P5.1 explain PENDING", () => {
  it("PENDING explains the missing 15M trigger and does not look like WAIT", () => {
    const s = setup({
      state: "pending",
      qualityPhase: "preliminar",
      missingForEntry: "Falta: cierre 15M de fallo de aceptación o rechazo.",
    });
    const view = explain(
      base({
        setupState: "pending",
        waitReason: null,
        missingForEntry: s.missingForEntry,
        setup: s,
        bias4hLabel: "BAJISTA LOCAL · BOS",
      }),
    );
    assert.equal(view.state, "pending");
    assert.equal(view.stateLabel, "TRIGGER PENDIENTE");
    assert.match(view.headline, /falta la confirmación/i);
    assert.equal(view.checks.find((c) => c.id === "bos")?.status, "ok");
    assert.equal(view.checks.find((c) => c.id === "retorno")?.status, "ok");
    assert.equal(view.checks.find((c) => c.id === "trigger")?.status, "fail");
    assert.match(view.motive, /cierre 15M/);
    assert.notEqual(view.stateLabel, "ESPERAR");
  });

  it("unknown missing fragment is kept", () => {
    const view = explain(
      base({
        setupState: "pending",
        waitReason: null,
        missingForEntry: "Falta: unicornio cuantico.",
        setup: setup({ state: "pending", missingForEntry: "Falta: unicornio cuantico." }),
      }),
    );
    assert.ok(view.extras.some((e) => /unicornio cuantico/i.test(e)));
  });
});

describe("P5.1 explain ENTRY", () => {
  it("ENTRY checklist is complete and uses setup levels / R:R", () => {
    const s = setup();
    const view = explain(
      base({
        setupState: "entry",
        waitReason: null,
        setup: s,
        digits: 2,
        bias4hLabel: "BAJISTA LOCAL · BOS",
        volumeRatio15: 1.7,
      }),
    );
    assert.equal(view.state, "entry");
    assert.equal(view.stateLabel, "ENTRADA");
    assert.equal(view.direction, "VENTA");
    for (const id of ["bos", "origen", "retorno", "rr", "trigger"]) {
      assert.equal(view.checks.find((c) => c.id === id)?.status, "ok", id);
    }
    assert.ok(view.levels);
    assert.match(view.levels!.entry ?? "", /77\.500/);
    assert.match(view.levels!.sl, /78\.150/);
    assert.match(view.levels!.tp1, /77\.100/);
    assert.match(view.levels!.tp2, /76\.800/);
    assert.equal(view.levels!.rr, "1 : 2.1");
    assert.match(view.checks.find((c) => c.id === "rr")!.seeing, /2\.1/);
    assert.match(view.disclaimer, /NO ES UNA ORDEN/);
  });

  it("does not invent R:R — it comes from the setup", () => {
    const view = explain(
      base({
        setupState: "entry",
        waitReason: null,
        setup: setup({ riskReward: 1.8 }),
      }),
    );
    assert.equal(view.levels!.rr, "1 : 1.8");
    assert.doesNotMatch(view.levels!.rr, /2\.1/);
  });
});

describe("P5.1 P5 does not change V1 state", () => {
  it("output state equals input state for every V1 state", () => {
    const states: SetupState[] = ["wait", "map", "pending", "entry"];
    for (const setupState of states) {
      const s = setupState === "wait" ? null : setup({ state: setupState });
      const view = explain(
        base({
          setupState,
          waitReason: setupState === "wait" ? "ESPERAR — no hay BOS 4H por cierre." : null,
          missingForEntry: setupState === "pending" ? "Falta: cierre 15M de fallo de aceptación o rechazo." : null,
          setup: s,
        }),
      );
      assert.equal(view.state, setupState);
    }
  });
});

describe("P5.1 live analysis helper", () => {
  it("ENTRY from AssetAnalysis uses volume from 15M if present", () => {
    const view = explainFromAnalysis(
      analysis({
        setupState: "entry",
        signal: "sell",
        setup: setup(),
        waitReason: null,
        wouldTrade: "wait",
      }),
    );
    assert.equal(view.state, "entry");
    assert.match(view.checks.find((c) => c.id === "volumen")!.seeing, /1\.60|1,60|1.6/);
  });
});

describe("P5.1 history freeze gaps", () => {
  it("missing freeze fields become Pendiente, not reconstructed", () => {
    const freeze: EpisodeFreeze = {
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
      capturedAtMs: 1,
    };
    const episode: EpisodeDraft = {
      episodeId: "e1",
      assetId: "BTCUSD",
      direction: "sell",
      kind: "continuation",
      zoneLow: 77500,
      zoneHigh: 77600,
      sl: 78150,
      tp1: 77100,
      tp2: 76800,
      openedAtMs: 1,
      openedState: "entry",
      currentState: "entry",
      closedAtMs: null,
      levelsKey: "k",
      openedSlot: 1,
      freeze,
    };
    const row: HistoryRow = {
      episode,
      outcome: "tp1",
      firstTouch: "tp1",
      firstTouchAtMs: 2,
      mfe: null,
      mae: null,
    };
    const view = explainFromHistory(row);
    assert.equal(view.state, "entry");
    assert.equal(view.checks.find((c) => c.id === "bos")?.status, "pending");
    assert.equal(view.checks.find((c) => c.id === "bos")?.seeing, PENDING_HISTORY);
    assert.ok(view.levels);
    assert.match(view.levels!.rr, /1\.8/);
    assert.ok(view.extras.some((e) => /tp1/i.test(e)));
  });
});

describe("P5.1 missingParts / disclaimer", () => {
  it("splits V1 missingForEntry without inventing tokens", () => {
    assert.deepEqual(missingParts("Falta: cierre 15M de fallo de aceptación o rechazo; volumen 15M insuficiente."), [
      "cierre 15M de fallo de aceptación o rechazo",
      "volumen 15M insuficiente",
    ]);
  });

  it("disclaimer is analysis-only", () => {
    assert.match(EXPLAIN_DISCLAIMER, /NO ES UNA ORDEN/);
    assert.match(EXPLAIN_DISCLAIMER, /no cambia la decisión/i);
  });
});

describe("P5.1 glossary", () => {
  it("covers the required concepts", () => {
    const need = [
      "bos",
      "estructura",
      "zona",
      "origen-htf",
      "volumen",
      "trigger",
      "rr",
      "entrada",
      "sl",
      "tp1",
      "tp2",
      "caducidad",
      "invalidacion",
      "noticia",
      "subyacente",
      "mapa",
      "pending",
      "entry",
      "wait",
    ];
    for (const id of need) {
      assert.ok(GLOSSARY_IDS.includes(id), id);
      const g = GLOSSARY.find((x) => x.id === id);
      assert.ok(g && g.what && g.forAtalaya && g.example);
      assert.ok(g.what.split(".").length <= 6);
    }
  });
});
