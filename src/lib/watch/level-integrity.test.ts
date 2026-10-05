import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle, SetupProposal } from "../trading/types.ts";
import type { EpisodeDraft } from "./episode.ts";
import type { EpisodeFreeze } from "./freeze.ts";
import { detectBosChoch } from "../trading/structure.ts";
import { buildMomentumContinuation } from "./continuation.ts";
import {
  assessExecutableLevels,
  assessSetupLevels,
  canonicalFeedSymbols,
  instrumentVerdict,
  shiftLevels,
  stopFromStructuralAnchor,
  xauBasisVerdict,
} from "./level-integrity.ts";
import { slotOpenSec, slotSecFromNow } from "./identity.ts";
import { createMemoryStore } from "./store-memory.ts";
import { runWatchTick, rejectionsFromEval, type WatchLoad } from "./tick.ts";

const buy = {
  direction: "buy" as const,
  entry: 100,
  stop: 90,
  target: 120,
  digits: 2,
};
const sell = {
  direction: "sell" as const,
  entry: 100,
  stop: 110,
  target: 80,
  digits: 2,
};

function proposal(partial: Partial<SetupProposal> & Pick<SetupProposal, "direction" | "zone" | "stopLoss" | "takeProfit1">): SetupProposal {
  return {
    state: "entry",
    kind: "continuation",
    riskReward: 2,
    quality: "media",
    qualityPhase: "final",
    invalidation: partial.stopLoss,
    takeProfit2: null,
    supersedeLevel: null,
    missingForEntry: null,
    slWide: false,
    warnings: [],
    managementNote: "",
    entryLabel: "100.00",
    ...partial,
  };
}

describe("niveles ejecutables", () => {
  it("compra válida conserva los niveles", () => {
    const before = { ...buy };
    const verdict = assessExecutableLevels(before);
    assert.deepEqual(verdict, { ok: true, reason: null });
    assert.deepEqual(before, buy);
  });

  it("venta válida conserva los niveles", () => {
    const before = { ...sell };
    const verdict = assessExecutableLevels(before);
    assert.deepEqual(verdict, { ok: true, reason: null });
    assert.deepEqual(before, sell);
  });

  it("rechaza el SL en el lado incorrecto", () => {
    assert.equal(assessExecutableLevels({ ...buy, stop: 105 }).reason, "stop-wrong-side");
    assert.equal(assessExecutableLevels({ ...sell, stop: 95 }).reason, "stop-wrong-side");
  });

  it("rechaza el TP en el lado incorrecto", () => {
    assert.equal(assessExecutableLevels({ ...buy, target: 95 }).reason, "target-wrong-side");
    assert.equal(assessExecutableLevels({ ...sell, target: 115 }).reason, "target-wrong-side");
  });

  it("rechaza riesgo cero y valores no finitos", () => {
    assert.equal(assessExecutableLevels({ ...buy, stop: 100 }).reason, "risk-not-positive");
    assert.equal(assessExecutableLevels({ ...sell, target: 100 }).reason, "risk-not-positive");
    assert.equal(assessExecutableLevels({ ...buy, entry: Number.NaN }).reason, "non-finite");
    assert.equal(assessExecutableLevels({ ...sell, stop: Number.POSITIVE_INFINITY }).reason, "non-finite");
  });

  it("no deja que el colchón rescate un swing del lado equivocado", () => {
    const rescued = stopFromStructuralAnchor({ direction: "sell", entry: 110, anchor: 100, pad: 20 });
    assert.equal(rescued.ok, false);
    if (!rescued.ok) assert.equal(rescued.reason, "anchor-wrong-side");
    const kept = stopFromStructuralAnchor({ direction: "buy", entry: 100, anchor: 90, pad: 2 });
    assert.deepEqual(kept, { ok: true, stop: 88 });
  });

  it("el redondeo y un basis constante no fabrican un nivel", () => {
    const tight = assessExecutableLevels({
      direction: "buy",
      entry: 100.004,
      stop: 100.001,
      target: 101,
      digits: 2,
    });
    assert.equal(tight.reason, "rounded-order");

    const shifted = shiftLevels(sell, 1.25);
    assert.ok(shifted);
    assert.equal(shifted.entry, sell.entry - 1.25);
    assert.equal(shifted.stop - shifted.entry, sell.stop - sell.entry);
    assert.equal(shifted.entry - shifted.target, sell.entry - sell.target);
    assert.equal(assessExecutableLevels({ ...sell, ...shifted }).reason, null);

    const collapsed = shiftLevels(
      { direction: "buy" as const, entry: 100.004, stop: 100.001, target: 101, digits: 2 },
      0.003,
    );
    assert.ok(collapsed);
    assert.equal(assessExecutableLevels(collapsed).reason, "rounded-order");
    assert.equal(shiftLevels(sell, Number.NaN), null);
  });

  it("rechaza mezclar instrumentos", () => {
    const verdict = assessExecutableLevels({
      ...sell,
      instrument: "NQ=F",
      referenceInstrument: "NDX100USDT",
    });
    assert.equal(verdict.reason, "instrument");
    assert.equal(
      assessSetupLevels(proposal({
        direction: "sell",
        zone: { low: 100, high: 110 },
        stopLoss: 110,
        takeProfit1: 80,
      }), 2, { instrument: "XAUUSDT", referenceInstrument: "XAUUSDT" }).reason,
      null,
    );
  });
});

const CLOSE = Date.parse("2026-09-08T12:00:00Z");
const NOW = CLOSE + 20_000;

function m15WrongSideAnchor(): Candle[] {
  const open = CLOSE / 1000 - 900;
  const bars: Candle[] = [];
  for (let i = 0; i < 16; i++) {
    const time = open - (15 - i) * 900;
    let high = 80;
    let low = 70;
    let close = 75;
    let openPx = 76;
    if (i === 8) {
      high = 100;
      low = 90;
      close = 95;
      openPx = 92;
    } else if (i >= 11 && i < 15) {
      high = 140 + (i - 11) * 10;
      low = high - 5;
      close = high - 1;
      openPx = low + 1;
    } else if (i === 15) {
      openPx = 190;
      high = 190;
      low = 125;
      close = 130;
    }
    bars.push({ time, open: openPx, high, low, close, volume: 10 });
  }
  return bars;
}

function bearishContext(stepSec: number): Candle[] {
  const start = CLOSE / 1000 - 40 * stepSec;
  const bars: Candle[] = [];
  for (let i = 0; i < 24; i++) {
    let open = 106;
    let high = 110;
    let low = 100;
    let close = 105;
    if (i === 8) {
      open = 88;
      high = 90;
      low = 70;
      close = 75;
    }
    if (i > 14) {
      close = 60 - (i - 15);
      open = close + 2;
      high = open + 1;
      low = close - 1;
    }
    bars.push({ time: start + i * stepSec, open, high, low, close, volume: 10 });
  }
  return bars;
}

describe("continuación con ancla inválida", () => {
  it("no publica la entrada cuando el swing queda del lado equivocado", () => {
    const m15 = m15WrongSideAnchor();
    const h1 = bearishContext(3600);
    const h4 = bearishContext(14_400);
    assert.equal(detectBosChoch(h1).bias, "bajista");
    assert.equal(detectBosChoch(h4).bias, "bajista");
    const reasons: string[] = [];
    const setup = buildMomentumContinuation({
      id: "BTCUSD",
      m15,
      h1,
      h4,
      nowMs: NOW,
      basis: null,
      digits: 2,
      instrument: "BTCUSDT",
      onIntegrityReject: (info) => reasons.push(info.reason),
    });
    assert.equal(setup, null);
    assert.deepEqual(reasons, ["anchor-wrong-side"]);
  });
});

function load(
  asset: WatchLoad["assets"][number],
  bars: Candle[],
  instrument: string | null = "BTCUSDT",
): WatchLoad {
  return {
    assets: [asset],
    m15ByAsset: { BTCUSD: bars, [asset.id]: bars },
    h1ByAsset: { [asset.id]: [] },
    h4ByAsset: { [asset.id]: [] },
    instrumentByAsset: { [asset.id]: instrument },
    errors: [],
  };
}

describe("tick no publica una entrada inválida", () => {
  const slot = slotSecFromNow(NOW);
  const bar: Candle = {
    time: slotOpenSec(slot),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  };

  it("una entrada V1 inválida después del TP adaptado no crea episodio ni aviso", async () => {
    const store = createMemoryStore();
    const notified: string[] = [];
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => load({
        id: "BTCUSD",
        setupState: "entry",
        digits: 2,
        waitReason: null,
        setup: proposal({
          direction: "sell",
          zone: { low: 100, high: 100 },
          stopLoss: 90,
          takeProfit1: 120,
        }),
      }, [bar]),
      notify: async (events) => {
        for (const ev of events) notified.push(ev.toState);
        return events.length;
      },
    });
    assert.equal(result.status, "ok");
    assert.equal(result.assets[0]?.state, "wait");
    assert.deepEqual(result.rejections.map((r) => r.reason), ["stop-wrong-side"]);
    assert.equal(await store.getOpenEpisode("BTCUSD"), null);
    assert.deepEqual(notified, []);
  });

  it("una entrada válida conserva los niveles y se notifica una sola vez", async () => {
    const store = createMemoryStore();
    const notified: string[] = [];
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => load({
        id: "BTCUSD",
        setupState: "entry",
        digits: 2,
        waitReason: null,
        setup: proposal({
          direction: "sell",
          zone: { low: 100, high: 110 },
          stopLoss: 112,
          takeProfit1: 80,
        }),
      }, [bar]),
      notify: async (events) => {
        for (const ev of events) notified.push(ev.toState);
        return events.length;
      },
    });
    assert.equal(result.rejections.length, 0);
    assert.equal(result.assets[0]?.state, "entry");
    const episode = await store.getOpenEpisode("BTCUSD");
    assert.ok(episode);
    assert.equal(episode.currentState, "entry");
    assert.equal(episode.zoneLow, 100);
    assert.equal(episode.zoneHigh, 110);
    assert.equal(episode.sl, 112);
    assert.equal(episode.tp1, 80);
    assert.deepEqual(notified, ["entry"]);
  });

  it("MAP, PENDING y WAIT no se convierten en entradas", async () => {
    for (const setupState of ["map", "pending", "wait"] as const) {
      const store = createMemoryStore();
      const notified: string[] = [];
      const result = await runWatchTick({
        nowMs: NOW,
        store,
        load: async () => load({
          id: "BTCUSD",
          setupState,
          digits: 2,
          waitReason: setupState === "wait" ? "ESPERAR" : null,
          setup: setupState === "wait" ? null : proposal({
            direction: "sell",
            state: setupState,
            zone: { low: 100, high: 110 },
            stopLoss: 90,
            takeProfit1: 120,
          }),
        }, [bar]),
        notify: async (events) => {
          for (const ev of events) notified.push(ev.toState);
          return events.length;
        },
      });
      assert.equal(result.assets[0]?.state, setupState);
      assert.equal(notified.includes("entry"), false);
      assert.equal(result.rejections.length, 0);
      const episode = await store.getOpenEpisode("BTCUSD");
      if (setupState === "wait") assert.equal(episode, null);
      else assert.equal(episode?.currentState, setupState);
    }
  });

  it("una continuación inválida no se guarda ni se notifica", async () => {
    const store = createMemoryStore();
    const notified: string[] = [];
    const m15 = m15WrongSideAnchor();
    const h1 = bearishContext(3600);
    const h4 = bearishContext(14_400);
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => ({
        assets: [{ id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 }],
        m15ByAsset: { BTCUSD: m15 },
        h1ByAsset: { BTCUSD: h1 },
        h4ByAsset: { BTCUSD: h4 },
        instrumentByAsset: { BTCUSD: "BTCUSDT" },
        errors: [],
      }),
      notify: async (events) => {
        for (const ev of events) notified.push(ev.toState);
        return events.length;
      },
    });
    assert.equal(result.assets[0]?.state, "wait");
    assert.deepEqual(result.rejections.map((r) => r.reason), ["anchor-wrong-side"]);
    assert.equal(result.rejections[0]?.source, "continuation");
    const stored = rejectionsFromEval((await store.getEval(slot))?.assets);
    assert.deepEqual(stored.map((r) => r.reason), ["anchor-wrong-side"]);
    assert.equal(stored.length, 1);
    assert.equal(await store.getOpenEpisode("BTCUSD"), null);
    assert.deepEqual(notified, []);
  });
});

function xauFreeze(basis: number | null): EpisodeFreeze {
  return {
    slotClosePrice: 100,
    quality: null,
    riskReward: null,
    dataSource: null,
    feedSymbol: "XAUUSDT",
    instrumentKind: "proxy",
    basis,
    dataStatus: "ok",
    waitReason: null,
    highImpact: false,
    underlyingClosed: false,
    timeframe: "15m",
    setupKind: null,
    capturedAtMs: NOW,
  };
}

function m15WideRisk(): Candle[] {
  const open = CLOSE / 1000 - 900;
  const bars: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    const time = open - (19 - i) * 900;
    let high = 101;
    let low = 100;
    let close = 100.4;
    let openPx = 100.2;
    if (i === 8) {
      openPx = 100;
      high = 180;
      low = 100;
      close = 101;
    } else if (i === 19) {
      openPx = 110;
      high = 110;
      low = 90;
      close = 92;
    }
    bars.push({ time, open: openPx, high, low, close, volume: 10 });
  }
  return bars;
}

describe("registro durable y base de precios", () => {
  const slot = slotSecFromNow(NOW);

  it("el feed canónico no incluye el futuro de Yahoo", () => {
    assert.equal(canonicalFeedSymbols("BTCUSD").includes("BTCUSDT"), true);
    assert.equal(canonicalFeedSymbols("BTCUSD").includes("XBTUSD"), true);
    assert.equal(canonicalFeedSymbols("XAUUSD").includes("GC=F"), false);
    assert.equal(canonicalFeedSymbols("US100").includes("NQ=F"), false);
    assert.equal(instrumentVerdict("US100", "NQ=F").reason, "instrument");
    assert.equal(instrumentVerdict("XAUUSD", "GC=F").reason, "instrument");
    assert.equal(instrumentVerdict("XAUUSD", "").reason, "instrument");
    assert.equal(instrumentVerdict("XAUUSD", "XAUUSDT").reason, null);
    assert.equal(xauBasisVerdict(null).reason, "basis");
    assert.equal(xauBasisVerdict(Number.NaN).reason, "basis");
    assert.equal(xauBasisVerdict(Number.POSITIVE_INFINITY).reason, "basis");
    assert.equal(xauBasisVerdict(1.25).reason, null);
  });

  it("un instrumento ajeno en el tick no crea episodio ni aviso", async () => {
    const store = createMemoryStore();
    const notified: string[] = [];
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => load({
        id: "BTCUSD",
        setupState: "entry",
        digits: 2,
        waitReason: null,
        setup: proposal({
          direction: "sell",
          zone: { low: 100, high: 110 },
          stopLoss: 112,
          takeProfit1: 80,
        }),
      }, [barAtSlot()], "NQ=F"),
      notify: async (events) => {
        for (const ev of events) notified.push(ev.toState);
        return events.length;
      },
    });
    assert.deepEqual(result.rejections.map((r) => r.reason), ["instrument"]);
    assert.equal(result.rejections[0]?.source, "entry");
    assert.equal(result.assets[0]?.state, "wait");
    assert.equal(await store.getOpenEpisode("BTCUSD"), null);
    assert.deepEqual(notified, []);
    assert.deepEqual(rejectionsFromEval((await store.getEval(slot))?.assets).map((r) => r.reason), ["instrument"]);
  });

  it("sin instrumento la entrada no se publica", async () => {
    const store = createMemoryStore();
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => load({
        id: "BTCUSD",
        setupState: "entry",
        digits: 2,
        waitReason: null,
        setup: proposal({
          direction: "sell",
          zone: { low: 100, high: 110 },
          stopLoss: 112,
          takeProfit1: 80,
        }),
      }, [barAtSlot()], null),
    });
    assert.deepEqual(result.rejections.map((r) => r.reason), ["instrument"]);
    assert.equal(await store.getOpenEpisode("BTCUSD"), null);
  });

  it("XAU sin basis finito no publica la entrada", async () => {
    for (const basis of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const store = createMemoryStore();
      const notified: string[] = [];
      const result = await runWatchTick({
        nowMs: NOW,
        store,
        load: async () => load({
          id: "XAUUSD",
          setupState: "entry",
          digits: 2,
          waitReason: null,
          freeze: xauFreeze(basis),
          setup: proposal({
            direction: "sell",
            zone: { low: 100, high: 110 },
            stopLoss: 112,
            takeProfit1: 80,
          }),
        }, [barAtSlot()], "XAUUSDT"),
        notify: async (events) => {
          for (const ev of events) notified.push(ev.toState);
          return events.length;
        },
      });
      assert.deepEqual(result.rejections.map((r) => r.reason), ["basis"], String(basis));
      assert.equal(result.rejections[0]?.source, "entry");
      assert.equal(await store.getOpenEpisode("XAUUSD"), null);
      assert.deepEqual(notified, []);
      assert.equal(rejectionsFromEval((await store.getEval(slot))?.assets)[0]?.reason, "basis");
    }
  });

  it("XAU con basis finito y feed propio conserva la entrada", async () => {
    const store = createMemoryStore();
    const notified: string[] = [];
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => load({
        id: "XAUUSD",
        setupState: "entry",
        digits: 2,
        waitReason: null,
        freeze: xauFreeze(1.25),
        setup: proposal({
          direction: "sell",
          zone: { low: 100, high: 110 },
          stopLoss: 112,
          takeProfit1: 80,
        }),
      }, [barAtSlot()], "XAUUSDT"),
      notify: async (events) => {
        for (const ev of events) notified.push(ev.toState);
        return events.length;
      },
    });
    assert.equal(result.rejections.length, 0);
    const episode = await store.getOpenEpisode("XAUUSD");
    assert.equal(episode?.currentState, "entry");
    assert.equal(episode?.sl, 112);
    assert.equal(episode?.tp1, 80);
    assert.equal(episode?.zoneLow, 100);
    assert.deepEqual(notified, ["entry"]);
  });

  it("la continuación XAU no convierte un basis ausente o no finito", async () => {
    const m15 = m15WrongSideAnchor();
    const h1 = bearishContext(3600);
    const h4 = bearishContext(14_400);
    for (const basis of [null, Number.NaN, Number.POSITIVE_INFINITY] as const) {
      const reasons: string[] = [];
      const setup = buildMomentumContinuation({
        id: "XAUUSD",
        m15,
        h1,
        h4,
        nowMs: NOW,
        basis,
        digits: 2,
        instrument: "XAUUSDT",
        onIntegrityReject: (info) => reasons.push(info.reason),
      });
      assert.equal(setup, null, String(basis));
      assert.deepEqual(reasons, ["basis"], String(basis));
    }
  });

  it("un feed ajeno en la continuación queda registrado y no es una entrada", async () => {
    const store = createMemoryStore();
    const notified: string[] = [];
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => ({
        assets: [{ id: "BTCUSD", setupState: "map", setup: proposal({
          direction: "sell",
          state: "map",
          zone: { low: 100, high: 110 },
          stopLoss: 112,
          takeProfit1: 80,
        }), waitReason: null, digits: 2 }],
        m15ByAsset: { BTCUSD: m15WrongSideAnchor() },
        h1ByAsset: { BTCUSD: bearishContext(3600) },
        h4ByAsset: { BTCUSD: bearishContext(14_400) },
        instrumentByAsset: { BTCUSD: "GC=F" },
        errors: [],
      }),
      notify: async (events) => {
        for (const ev of events) notified.push(ev.toState);
        return events.length;
      },
    });
    assert.equal(result.assets[0]?.state, "map");
    assert.deepEqual(result.rejections.map((r) => ({ reason: r.reason, source: r.source })), [
      { reason: "instrument", source: "continuation" },
    ]);
    assert.equal(notified.includes("entry"), false);
    const episode = await store.getOpenEpisode("BTCUSD");
    assert.equal(episode?.currentState, "map");
    assert.equal(rejectionsFromEval((await store.getEval(slot))?.assets).length, 1);
  });

  it("el riesgo por encima del límite de la continuación queda consultable", async () => {
    const store = createMemoryStore();
    const notified: string[] = [];
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => ({
        assets: [{ id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR", digits: 2 }],
        m15ByAsset: { BTCUSD: m15WideRisk() },
        h1ByAsset: { BTCUSD: bearishContext(3600) },
        h4ByAsset: { BTCUSD: bearishContext(14_400) },
        instrumentByAsset: { BTCUSD: "BTCUSDT" },
        errors: [],
      }),
      notify: async (events) => {
        for (const ev of events) notified.push(ev.toState);
        return events.length;
      },
    });
    assert.equal(result.assets[0]?.state, "wait");
    assert.deepEqual(result.rejections.map((r) => r.reason), ["risk-out-of-bounds"]);
    assert.equal(result.rejections[0]?.source, "continuation");
    assert.equal(rejectionsFromEval((await store.getEval(slot))?.assets)[0]?.reason, "risk-out-of-bounds");
    assert.equal(await store.getOpenEpisode("BTCUSD"), null);
    assert.deepEqual(notified, []);
  });

  it("un episodio abierto no se reescribe ni se notifica al rechazar la entrada", async () => {
    const store = createMemoryStore();
    const open: EpisodeDraft = {
      episodeId: "BTCUSD-1-intact",
      assetId: "BTCUSD",
      direction: "sell",
      kind: "break-retest",
      zoneLow: 100,
      zoneHigh: 110,
      sl: 112,
      tp1: 80,
      tp2: null,
      openedAtMs: NOW - 900_000,
      openedState: "map",
      currentState: "map",
      closedAtMs: null,
      levelsKey: "keep",
      openedSlot: slot - 900,
      freeze: null,
    };
    await store.upsertEpisode(open);
    const before = { ...(await store.getOpenEpisode("BTCUSD"))! };
    const notified: string[] = [];
    const result = await runWatchTick({
      nowMs: NOW,
      store,
      load: async () => load({
        id: "BTCUSD",
        setupState: "entry",
        digits: 2,
        waitReason: null,
        setup: proposal({
          direction: "sell",
          zone: { low: 100, high: 100 },
          stopLoss: 90,
          takeProfit1: 120,
        }),
      }, [barAtSlot()], "BTCUSDT"),
      notify: async (events) => {
        for (const ev of events) notified.push(ev.toState);
        return events.length;
      },
    });
    const after = await store.getOpenEpisode("BTCUSD");
    assert.deepEqual(result.rejections.map((r) => r.reason), ["stop-wrong-side"]);
    assert.equal(after?.episodeId, before.episodeId);
    assert.equal(after?.currentState, "map");
    assert.equal(after?.closedAtMs, null);
    assert.equal(after?.sl, 112);
    assert.equal(after?.tp1, 80);
    assert.equal(after?.zoneLow, 100);
    assert.equal(after?.zoneHigh, 110);
    assert.deepEqual(notified, []);
    assert.equal((await store.listInbox(20)).some((row) => row.toState === "entry"), false);
  });
});

function barAtSlot(): Candle {
  const slot = slotSecFromNow(NOW);
  return {
    time: slotOpenSec(slot),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  };
}
