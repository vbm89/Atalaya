import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Bar } from "../learn/price-behaviour/types.ts";
import { lastClosedOpen, planBars, runCycle, type PaperTape } from "./cycle.ts";
import { botLiveness, emptyState, paperPaths, readDecisions, readPaperView, readSignals, readState, writeState, blankBoard, type PaperState } from "./store.ts";

const T0 = Date.parse("2026-03-02T00:00:00Z") / 1000;

function bar(i: number, o: number, h: number, l: number, c: number): Bar {
  return { t: T0 + i * 900, o, h, l, c, v: 1 };
}

function fill(n: number, price: number, half: number): Bar[] {
  return Array.from({ length: n }, (_, i) => bar(i, price, price + half, price - half, price));
}

function trend(points: Array<[number, number]>, half = 0.6): Bar[] {
  const last = points[points.length - 1]![0];
  const px = new Array<number>(last + 1).fill(points[0]![1]);
  for (let p = 0; p < points.length - 1; p++) {
    const [i0, y0] = points[p]!;
    const [i1, y1] = points[p + 1]!;
    for (let i = i0; i <= i1; i++) px[i] = y0 + ((y1 - y0) * (i - i0)) / (i1 - i0);
  }
  return px.map((c, i) => bar(i, c, c + half, c - half, c));
}

function shift(bars: Bar[], lastT: number): Bar[] {
  const delta = lastT - bars[bars.length - 1]!.t;
  return bars.map((row) => ({ ...row, t: row.t + delta }));
}

function tape(bars: Bar[], source = "LIVE"): PaperTape {
  return { bars: bars.map((row) => ({ ...row, source: "test" })), source, note: null, attempts: [] };
}

function buyBars(lastT?: number): Bar[] {
  const bars = trend([
    [0, 100],
    [20, 108],
    [30, 102],
    [45, 116],
    [55, 108],
    [70, 124],
    [82, 112],
  ]);
  const buyLow = 107.4;
  bars.push(bar(83, buyLow + 0.3, buyLow + 1.15, buyLow - 0.25, buyLow + 1));
  return lastT == null ? bars : shift(bars, lastT);
}

function naturalBuy(): { bars: Bar[]; expected: number; now: number } {
  const bars = buyBars();
  const expected = bars[bars.length - 1]!.t;
  return { bars, expected, now: expected + 900 + 40 };
}

function dir(): string {
  return mkdtempSync(join(tmpdir(), "paper-bot-"));
}

describe("paper bot autónomo", () => {
  it("la primera pasada solo mira la última vela cerrada", () => {
    const now = 1_800_000_000;
    const expected = lastClosedOpen(now);
    assert.equal(planBars(null, expected).catchup.length, 0);
    assert.equal(planBars(null, expected).live, expected);
    assert.deepEqual(planBars(expected - 1800, expected).catchup, [expected - 900]);
    assert.ok(planBars(expected - 900 * 40, expected).omitted > 16);
    assert.equal(planBars(expected - 900 * 40, expected).catchup.length, 0);
  });

  it("guarda la decisión, sobrevive al reinicio y no duplica la vela", async () => {
    const root = dir();
    const { bars, expected, now } = naturalBuy();
    const load = async (asset: string) => (asset === "XAUUSD" ? tape(bars) : tape(shift(fill(70, 50, 0.2), expected)));
    const first = await runCycle({ dir: root, nowSec: now, load });
    assert.equal(first.signalsNew, 1);
    assert.equal(readSignals(root).length, 1);
    assert.equal(readDecisions(root).filter((row) => row.decision === "ESPERAR").length, 3);
    assert.equal(readSignals(root)[0]!.direction, "COMPRA");
    assert.equal(readSignals(root)[0]!.lastBarT, expected);
    assert.ok(existsSync(paperPaths(root).signals));
    const again = await runCycle({ dir: root, nowSec: now + 5, load });
    assert.equal(again.signalsNew, 0);
    assert.equal(again.duplicates, 0);
    assert.equal(readSignals(root).length, 1);
    assert.equal(readDecisions(root).length, 4);
    assert.equal(readState(root).lastProcessedBar, expected);
  });

  it("una vela nueva se evalúa y la anterior no se repite", async () => {
    const root = dir();
    const { bars, expected, now } = naturalBuy();
    const later = expected + 900;
    const now2 = later + 900 + 40;
    const firstLoad = async (asset: string) => (asset === "XAUUSD" ? tape(bars) : tape(shift(fill(70, 40, 0.2), expected)));
    await runCycle({ dir: root, nowSec: now, load: firstLoad });
    const before = readSignals(root).length;
    const secondLoad = async (asset: string) => {
      const base = asset === "XAUUSD" ? bars.map((row) => ({ ...row })) : shift(fill(70, 40, 0.2), expected);
      const prev = base[base.length - 1]!;
      base.push({ t: later, o: prev.c, h: prev.c + 0.2, l: prev.c - 0.2, c: prev.c, v: 1 });
      return tape(base);
    };
    const next = await runCycle({ dir: root, nowSec: now2, load: secondLoad });
    assert.ok(next.decisions >= 4);
    assert.equal(readSignals(root).filter((row) => row.lastBarT === expected).length, before);
    assert.ok(readDecisions(root).some((row) => row.lastBarT === later && row.mode === "LIVE"));
    assert.equal(readState(root).lastProcessedBar, later);
  });

  it("el catch-up no fabrica una señal retrospectiva", async () => {
    const root = dir();
    const now = 1_800_000_200;
    const expected = lastClosedOpen(now);
    const state = emptyState();
    state.assets.XAUUSD = { ...blankBoard("XAUUSD"), lastBarT: expected - 1800, evaluatedAt: 1, mode: "LIVE" };
    writeState(root, state);
    const load = async () => tape(shift(fill(80, 70, 0.3), expected));
    await runCycle({ dir: root, nowSec: now, load });
    const catchup = readDecisions(root).filter((row) => row.mode === "LIVE_CATCHUP");
    assert.equal(catchup.length, 1);
    assert.equal(catchup[0]!.decision, "ESPERAR");
    assert.equal(catchup[0]!.lastBarT, expected - 900);
    assert.equal(readSignals(root).filter((row) => row.lastBarT === expected - 900).length, 0);
  });

  it("una parada larga no rellena el hueco con señales", async () => {
    const root = dir();
    const now = 1_800_000_200;
    const expected = lastClosedOpen(now);
    const state: PaperState = emptyState();
    for (const asset of ["XAUUSD", "US100", "WTI", "BTCUSD"] as const) {
      state.assets[asset] = { ...blankBoard(asset), lastBarT: expected - 900 * 40, evaluatedAt: 1, mode: "LIVE" };
    }
    writeState(root, state);
    await runCycle({ dir: root, nowSec: now, load: async () => tape(shift(fill(80, 70, 0.3), expected)) });
    const catchup = readDecisions(root).filter((row) => row.mode === "LIVE_CATCHUP");
    assert.equal(catchup.length, 4);
    assert.match(catchup[0]!.reason, /No se reconstruyen/);
    assert.equal(readSignals(root).length, 0);
  });

  it("datos viejos y un activo caído no paran al resto", async () => {
    const root = dir();
    const now = 1_800_000_200;
    const expected = lastClosedOpen(now);
    const load = async (asset: string) => {
      if (asset === "XAUUSD") throw new Error("okx down");
      if (asset === "WTI") return tape(shift(fill(70, 60, 0.2), expected - 900));
      return tape(shift(fill(70, 55, 0.2), expected));
    };
    const report = await runCycle({ dir: root, nowSec: now, load });
    assert.ok(report.processed.includes("US100"));
    assert.ok(report.processed.includes("BTCUSD"));
    const xau = readDecisions(root).find((row) => row.asset === "XAUUSD");
    const wti = readDecisions(root).find((row) => row.asset === "WTI");
    assert.equal(xau?.decision, "ESPERAR");
    assert.equal(xau?.dataStatus, "DATA_ERROR");
    assert.equal(wti?.dataStatus, "DATA_STALE");
    assert.equal(wti?.decision, "ESPERAR");
    assert.equal(readSignals(root).length, 0);
    assert.equal(readState(root).assets.US100?.action, "ESPERAR");
    assert.equal(readState(root).assets.US100?.status, "DATA_OK");
  });

  it("si la vela nueva aún no está, espera y no reutiliza la anterior", async () => {
    const root = dir();
    const expected = lastClosedOpen(1_800_000_030);
    const now = expected + 900 + 30;
    const report = await runCycle({
      dir: root,
      nowSec: now,
      load: async () => tape(shift(fill(70, 40, 0.2), expected - 900)),
    });
    assert.equal(report.waited.length, 4);
    assert.equal(readDecisions(root).length, 0);
    assert.equal(readState(root).lastProcessedBar, null);
  });

  it("la vela abierta no entra en la decisión", async () => {
    const root = dir();
    const now = 1_800_000_040;
    const expected = lastClosedOpen(now);
    const load = async () => {
      const bars = shift(fill(70, 33, 0.2), expected);
      const open = bars[bars.length - 1]!;
      bars.push({ t: expected + 900, o: 1, h: 99999, l: 0.1, c: 88888, v: 1 });
      void open;
      return tape(bars);
    };
    await runCycle({ dir: root, nowSec: now, load });
    assert.equal(readState(root).assets.BTCUSD?.lastBarT, expected);
    assert.notEqual(readState(root).assets.BTCUSD?.price, 88888);
  });

  it("activo y detenido salen del latido, no de abrir la página", () => {
    const fresh = emptyState();
    fresh.workerRunning = true;
    fresh.pid = process.pid;
    fresh.lastHeartbeatAt = Date.now();
    assert.equal(botLiveness(fresh), "ACTIVO");
    fresh.lastHeartbeatAt = Date.now() - 120_000;
    assert.equal(botLiveness(fresh), "DETENIDO");
    fresh.lastHeartbeatAt = Date.now();
    fresh.pid = 2_147_000_000;
    assert.equal(botLiveness(fresh), "DETENIDO");
    const view = readPaperView(dir());
    assert.equal(view.bot, "DETENIDO");
    assert.equal(view.liveTrading, false);
    assert.equal(view.validatedEdge, false);
    assert.equal(view.signals.length, 0);
  });
});
