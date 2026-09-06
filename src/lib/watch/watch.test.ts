import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildSetup, closedCandles } from "../trading/engine.ts";
import { TF_STEP_SEC } from "../trading/integrity.ts";
import type { Candle } from "../trading/types.ts";
import {
  analysisCoversClose,
  lastBarCloseMs,
  nextWatchEvalMs,
  shouldEvalNow,
  WATCH_STEP_MS,
} from "./schedule.ts";
import { foldAssetWatch, foldWatchBook, setupsEqual, watchBooksEqual, setupStateEs, type AssetWatch } from "./memory.ts";

type Pack = { m15: number[][]; h1: number[][]; h4: number[][] };

function inflate(rows: number[][]): Candle[] {
  return rows.map((k) => ({
    time: k[0]!,
    open: k[1]!,
    high: k[2]!,
    low: k[3]!,
    close: k[4]!,
    volume: k[5]!,
  }));
}

function atClose(barTimeSec: number): number {
  return (barTimeSec + TF_STEP_SEC["15m"]) * 1000 + 1;
}

function runAt(pack: { m15: Candle[]; h1: Candle[]; h4: Candle[] }, now: number) {
  return buildSetup({
    now,
    price: pack.m15.filter((c) => c.time * 1000 < now).at(-1)?.close ?? 0,
    digits: 2,
    m15: closedCandles(
      pack.m15.filter((c) => c.time * 1000 < now),
      "15m",
      now,
    ),
    h1: closedCandles(
      pack.h1.filter((c) => c.time * 1000 < now),
      "1h",
      now,
    ),
    h4: closedCandles(
      pack.h4.filter((c) => c.time * 1000 < now),
      "4h",
      now,
    ),
    highImpactNewsAt: null,
    newsTitle: null,
    underlyingClosed: false,
  });
}

describe("watch schedule", () => {
  it("evaluates after 15M close + grace, not every tick", () => {
    const close = Date.parse("2026-08-29T08:15:00.000Z");
    assert.equal(lastBarCloseMs(close), close);
    assert.equal(shouldEvalNow(close + 1000, null), false);
    assert.equal(shouldEvalNow(close + 8_000, null), true);
    assert.equal(shouldEvalNow(close + 8_000, close + 8_000), false);
    assert.equal(shouldEvalNow(close + 60_000, close + 8_000), false);
    const next = nextWatchEvalMs(close + 60_000);
    assert.equal(next, close + WATCH_STEP_MS + 8_000);
  });

  it("does not treat a snapshot from the previous 15M as covering this close", () => {
    const close = Date.parse("2026-08-29T08:15:00.000Z");
    assert.equal(analysisCoversClose(close - 60_000, close + 10_000), false);
    assert.equal(analysisCoversClose(close + 8_000, close + 10_000), true);
  });
});

describe("watch memory", () => {
  const setup = {
    state: "entry" as const,
    kind: "continuation" as const,
    direction: "sell" as const,
    zone: { low: 77626.01, high: 77731.43 },
    invalidation: 81478.87,
    stopLoss: 77747.0,
    takeProfit1: 76888,
    takeProfit2: 76670.01,
    riskReward: 6.1,
    quality: "media" as const,
    qualityPhase: "final" as const,
    supersedeLevel: null,
    missingForEntry: null,
    slWide: false,
    warnings: [],
    managementNote: "",
    entryLabel: "77626.01",
  };

  it("keeps a live ENTRADA and does not invent one from ESPERAR", () => {
    const live = foldAssetWatch(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null },
      1,
    );
    assert.equal(live.phase, "live");
    assert.equal(live.currentState, "entry");
    const stillWait = foldAssetWatch(
      null,
      { id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR" },
      1,
    );
    assert.equal(stillWait.phase, "wait");
    assert.equal(stillWait.expiredSetup, null);
  });

  it("records ESPERAR → MAPA → PENDIENTE → ENTRADA and keeps caducada after wait", () => {
    let w: AssetWatch | null = null;
    w = foldAssetWatch(w, { id: "BTCUSD", setupState: "map", setup, waitReason: null }, 10);
    assert.equal(w.transition, "ESPERAR → MAPA");
    w = foldAssetWatch(w, { id: "BTCUSD", setupState: "pending", setup, waitReason: null }, 20);
    assert.equal(w.transition, "MAPA → TRIGGER PENDIENTE");
    w = foldAssetWatch(w, { id: "BTCUSD", setupState: "entry", setup, waitReason: null }, 30);
    assert.equal(w.phase, "live");
    assert.equal(w.transition, "TRIGGER PENDIENTE → ENTRADA");
    w = foldAssetWatch(
      w,
      {
        id: "BTCUSD",
        setupState: "wait",
        setup: null,
        waitReason: "ESPERAR — sin setup válido actualmente.",
      },
      40,
    );
    assert.equal(w.phase, "expired");
    assert.equal(w.expiredFromState, "entry");
    assert.equal(w.expiredSetup?.takeProfit1, 76888);
    assert.match(w.expiredReason ?? "", /sin setup válido/);
    assert.equal(setupStateEs("entry"), "ENTRADA");
  });

  it("folds a book of 4 assets independently", () => {
    const book = foldWatchBook(
      {},
      [
        { id: "XAUUSD", setupState: "wait", setup: null, waitReason: "ESPERAR" },
        { id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR" },
        { id: "US100", setupState: "wait", setup: null, waitReason: "ESPERAR" },
        { id: "WTI", setupState: "wait", setup: null, waitReason: "ESPERAR" },
      ],
      1,
    );
    assert.equal(book.BTCUSD?.phase, "wait");
    assert.equal(book.XAUUSD?.phase, "wait");
  });

  it("treats two books as equal when only evaluatedAt differs", () => {
    const a = foldAssetWatch(
      null,
      { id: "BTCUSD", setupState: "entry", setup, waitReason: null },
      1,
    );
    const b = { ...a, evaluatedAt: 99 };
    assert.equal(watchBooksEqual({ BTCUSD: a }, { BTCUSD: b }), true);
    assert.equal(watchBooksEqual({ BTCUSD: a }, { BTCUSD: { ...a, phase: "wait" } }), false);
    assert.equal(setupsEqual(setup, { ...setup }), true);
    assert.equal(setupsEqual(setup, { ...setup, takeProfit1: setup.takeProfit1 + 1 }), false);
  });

  it("foldWatchBook always returns a new object even when phases do not change", () => {
    const first = foldWatchBook(
      {},
      [{ id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR" }],
      1,
    );
    const second = foldWatchBook(
      first,
      [{ id: "BTCUSD", setupState: "wait", setup: null, waitReason: "ESPERAR" }],
      2,
    );
    assert.notEqual(second, first);
    assert.equal(watchBooksEqual(first, second), true);
  });
});

describe("BTCUSD 29 ago 2026 — ENTRADA real del motor, no fabricada", () => {
  const raw = JSON.parse(
    readFileSync(new URL("./fixtures/btc-2026-08-29.json", import.meta.url), "utf8"),
  ) as Pack;
  const pack = { m15: inflate(raw.m15), h1: inflate(raw.h1), h4: inflate(raw.h4) };

  const entryBar = Date.parse("2026-08-29T08:00:00.000Z") / 1000;
  const pendingAfter = Date.parse("2026-08-29T08:15:00.000Z") / 1000;
  const expiredBar = Date.parse("2026-08-29T09:45:00.000Z") / 1000;

  it("el motor produce ENTRADA SHORT al cierre de la vela 10:00–10:15 Madrid", () => {
    const r = runAt(pack, atClose(entryBar));
    assert.equal(r.state, "entry");
    assert.equal(r.setup?.direction, "sell");
    assert.ok(r.setup);
    assert.ok(Math.abs(r.setup.zone.low - 77626.01) < 0.05);
    assert.ok(Math.abs(r.setup.takeProfit1 - 76888) < 1);
  });

  it("la capa de vigilancia refleja esa ENTRADA y luego la marca caducada, sin inventar otra", () => {
    const entry = runAt(pack, atClose(entryBar));
    let w = foldAssetWatch(
      null,
      { id: "BTCUSD", setupState: entry.state, setup: entry.setup, waitReason: entry.waitReason },
      atClose(entryBar),
    );
    assert.equal(w.phase, "live");
    assert.equal(w.currentState, "entry");

    const laterPending = runAt(pack, atClose(pendingAfter));
    w = foldAssetWatch(
      w,
      {
        id: "BTCUSD",
        setupState: laterPending.state,
        setup: laterPending.setup,
        waitReason: laterPending.waitReason,
      },
      atClose(pendingAfter),
    );
    assert.equal(w.phase, "live");
    assert.equal(w.currentState, "pending");
    assert.equal(w.transition, "ENTRADA → TRIGGER PENDIENTE");

    const dead = runAt(pack, atClose(expiredBar));
    assert.equal(dead.state, "wait");
    w = foldAssetWatch(
      w,
      { id: "BTCUSD", setupState: dead.state, setup: dead.setup, waitReason: dead.waitReason },
      atClose(expiredBar),
    );
    assert.equal(w.phase, "expired");
    assert.equal(w.expiredFromState, "pending");
    assert.ok(w.expiredSetup);
    assert.equal(dead.setup, null);
  });
});
