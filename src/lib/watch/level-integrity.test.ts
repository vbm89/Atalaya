import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle, SetupProposal } from "../trading/types.ts";
import { detectBosChoch } from "../trading/structure.ts";
import { buildMomentumContinuation } from "./continuation.ts";
import {
  assessExecutableLevels,
  assessSetupLevels,
  shiftLevels,
  stopFromStructuralAnchor,
} from "./level-integrity.ts";
import { slotOpenSec, slotSecFromNow } from "./identity.ts";
import { createMemoryStore } from "./store-memory.ts";
import { runWatchTick, type WatchLoad } from "./tick.ts";

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
    const setup = buildMomentumContinuation({
      id: "BTCUSD",
      m15,
      h1,
      h4,
      nowMs: NOW,
      basis: null,
      digits: 2,
    });
    assert.equal(setup, null);
  });
});

function load(asset: WatchLoad["assets"][number], bars: Candle[]): WatchLoad {
  return {
    assets: [asset],
    m15ByAsset: { [asset.id]: bars },
    h1ByAsset: { [asset.id]: [] },
    h4ByAsset: { [asset.id]: [] },
    instrumentByAsset: { [asset.id]: "BTCUSDT" },
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
    assert.equal(result.rejections.length, 0);
    assert.equal(await store.getOpenEpisode("BTCUSD"), null);
    assert.deepEqual(notified, []);
  });
});
