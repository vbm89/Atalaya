import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { settleSignal } from "../learn/price-behaviour/journal.ts";
import { appendSettle, appendSignal, readSignals, type StoredSignal } from "./store.ts";
import { closePath, episodeIdFor, excursionR, sessionNameOf } from "./study.ts";

const entryBar = { t: 1000, h: 250, l: 50 };
const buy = { direction: "COMPRA" as const, entry: 100, stop: 90, target: 130, lastBarT: 1000 };
const sell = { direction: "VENTA" as const, entry: 100, stop: 110, target: 70, lastBarT: 1000 };

describe("paper excursion", () => {
  it("ignores the entry candle and bars after the stop", () => {
    const bars = [entryBar, { t: 1900, h: 118, l: 96 }, { t: 2800, h: 102, l: 89 }, { t: 3700, h: 400, l: 80 }];
    const path = excursionR(buy, bars);
    assert.ok(Math.abs((path.mfeR ?? 0) - 1.8) < 1e-9);
    assert.ok(Math.abs((path.maeR ?? 0) - -1.1) < 1e-9);
    assert.equal(settleSignal({ ...paperOf(buy), direction: "COMPRA" }, bars.map(full)), "SL");
  });

  it("measures a short the same way and stops at the target", () => {
    const bars = [entryBar, { t: 1900, h: 104, l: 82 }, { t: 2800, h: 112, l: 95 }, { t: 3700, h: 130, l: 40 }];
    const path = excursionR(sell, bars);
    assert.ok(Math.abs((path.mfeR ?? 0) - 1.8) < 1e-9);
    assert.ok(Math.abs((path.maeR ?? 0) - -1.2) < 1e-9);
    assert.equal(settleSignal({ ...paperOf(sell), direction: "VENTA" }, bars.map(full)), "SL");

    const tp = excursionR(
      { direction: "COMPRA", entry: 100, stop: 90, target: 115, lastBarT: 1000 },
      [entryBar, { t: 1900, h: 116, l: 99 }, { t: 2800, h: 200, l: 90 }],
    );
    assert.ok(Math.abs((tp.mfeR ?? 0) - 1.6) < 1e-9);
    assert.ok(Math.abs((tp.maeR ?? 0) - -0.1) < 1e-9);
    assert.equal(
      settleSignal(
        { ...paperOf(buy), direction: "COMPRA", target: 115 },
        [full(entryBar), full({ t: 1900, h: 116, l: 99 }), full({ t: 2800, h: 200, l: 90 })],
      ),
      "TP",
    );
  });

  it("returns null until a later candle exists and does not invent a risk", () => {
    assert.deepEqual(excursionR(buy, [entryBar]), { mfeR: null, maeR: null });
    assert.deepEqual(excursionR({ ...buy, stop: 100 }, [{ t: 1900, h: 110, l: 95 }]), { mfeR: null, maeR: null });
  });

  it("stores the path on settle without changing the result", () => {
    const root = mkdtempSync(join(tmpdir(), "paper-mfe-"));
    const row: StoredSignal = {
      kind: "signal",
      signalId: "XAUUSD|1000",
      asset: "XAUUSD",
      timeframe: "15m",
      timestamp: 1900,
      provider: "test",
      lastBarT: 1000,
      direction: "COMPRA",
      entry: 100,
      stop: 90,
      target: 130,
      RR: 3,
      setup: "FAILED_BREAKOUT",
      marketState: "RANGE",
      event: "FAILED_BREAKOUT_DOWN",
      confirmation: true,
      evidence: {},
      rationale: "",
      createdAt: 1900,
      tier: "FULL",
      result: "ABIERTA",
      resultR: null,
      study: null,
      revisionOf: null,
    };
    appendSignal(root, row);
    const path = excursionR(buy, [entryBar, { t: 1900, h: 118, l: 96 }, { t: 2800, h: 102, l: 89 }]);
    appendSettle(root, row.signalId, "SL", 2800, path);
    const stored = readSignals(root)[0]!;
    assert.equal(stored.result, "SL");
    assert.equal(stored.resultR, -1);
    assert.ok(Math.abs((stored.mfeR ?? 0) - 1.8) < 1e-9);
    assert.ok(Math.abs((stored.maeR ?? 0) - -1.1) < 1e-9);
  });

  it("separates the exit candle from the path before it", () => {
    const bars = [entryBar, { t: 1900, h: 105, l: 97 }, { t: 2800, h: 125, l: 89 }, { t: 3700, h: 400, l: 1 }];
    const path = closePath(buy, bars);
    assert.equal(path.exitBarT, 2800);
    assert.equal(path.barsHeld, 2);
    assert.ok(Math.abs((path.mfeR ?? 0) - 2.5) < 1e-9);
    assert.ok(Math.abs((path.mfeBeforeExitR ?? 0) - 0.5) < 1e-9);
    assert.ok(Math.abs((path.maeR ?? 0) - -1.1) < 1e-9);
    assert.equal(settleSignal({ ...paperOf(buy), direction: "COMPRA" }, bars.map(full)), "SL");
  });

  it("leaves the pre-exit MFE null when the first later candle is the close", () => {
    const path = closePath(buy, [entryBar, { t: 1900, h: 140, l: 80 }]);
    assert.equal(path.exitBarT, 1900);
    assert.equal(path.barsHeld, 1);
    assert.equal(path.mfeBeforeExitR, null);
    assert.ok((path.mfeR ?? 0) > 0);
  });

  it("measures a short exit the same way and ignores the entry candle", () => {
    const path = closePath(sell, [entryBar, { t: 1900, h: 103, l: 92 }, { t: 2800, h: 111, l: 60 }]);
    assert.equal(path.exitBarT, 2800);
    assert.equal(path.barsHeld, 2);
    assert.ok(Math.abs((path.mfeR ?? 0) - 4) < 1e-9);
    assert.ok(Math.abs((path.mfeBeforeExitR ?? 0) - 0.8) < 1e-9);
    assert.ok(Math.abs((path.maeR ?? 0) - -1.1) < 1e-9);
    assert.equal(closePath(sell, [entryBar]).exitBarT, null);
  });

  it("stores close telemetry without changing SL or resultR", () => {
    const root = mkdtempSync(join(tmpdir(), "paper-close-"));
    const row: StoredSignal = {
      kind: "signal",
      signalId: "WTI|1000",
      asset: "WTI",
      timeframe: "15m",
      timestamp: 1900,
      provider: "test",
      lastBarT: 1000,
      direction: "VENTA",
      entry: 100,
      stop: 110,
      target: 70,
      RR: 3,
      setup: "BREAKOUT_ACCEPTANCE",
      marketState: "TREND_DOWN",
      event: "BREAKOUT_DOWN",
      confirmation: true,
      evidence: {},
      rationale: "",
      createdAt: 1900,
      tier: "PARTIAL",
      result: "ABIERTA",
      resultR: null,
      study: {
        h1: "DOWN",
        h4: "DOWN",
        marketState: "TREND_DOWN",
        event: "BREAKOUT_DOWN",
        setup: "BREAKOUT_ACCEPTANCE",
        tier: "PARTIAL",
        direction: "SHORT",
        rr: 3,
        atr: 1,
        riskAtr: 1,
        displacement: null,
        reclaim: null,
        location: true,
        structure: true,
        confirmation: true,
        hourUtc: 12,
        session: "2026-10-02-LONDON",
        sessionName: "LONDON",
        episodeId: "WTI|1000",
        entry: 100,
        stop: 110,
        target: 70,
        resultR: null,
      },
      revisionOf: null,
    };
    appendSignal(root, row);
    const path = closePath(sell, [entryBar, { t: 1900, h: 103, l: 92 }, { t: 2800, h: 111, l: 60 }]);
    appendSettle(root, row.signalId, "SL", 2800, path);
    const stored = readSignals(root)[0]!;
    assert.equal(stored.result, "SL");
    assert.equal(stored.resultR, -1);
    assert.equal(stored.study?.resultR, -1);
    assert.equal(stored.exitBarT, 2800);
    assert.equal(stored.barsHeld, 2);
    assert.equal(stored.study?.exitBarT, 2800);
    assert.equal(stored.study?.barsHeld, 2);
    assert.equal(stored.study?.displacement, null);
    assert.ok(Math.abs((stored.mfeBeforeExitR ?? 0) - 0.8) < 1e-9);
    assert.equal(settleSignal({ ...paperOf(sell), direction: "VENTA" }, [full(entryBar), full({ t: 1900, h: 103, l: 92 }), full({ t: 2800, h: 111, l: 60 })]), "SL");
  });

  it("chains an episode across one bar and starts another after the gap", () => {
    const first = { signalId: "A", asset: "XAUUSD", direction: "VENTA" as const, lastBarT: 1000 };
    const second = { signalId: "B", asset: "XAUUSD", direction: "VENTA" as const, lastBarT: 1900 };
    const third = { signalId: "C", asset: "XAUUSD", direction: "VENTA" as const, lastBarT: 2800 };
    const later = { signalId: "D", asset: "XAUUSD", direction: "VENTA" as const, lastBarT: 4600 };
    const otherWay = { signalId: "E", asset: "XAUUSD", direction: "COMPRA" as const, lastBarT: 1900 };
    assert.equal(episodeIdFor(first, []), "A");
    const b = episodeIdFor(second, [first]);
    assert.equal(b, "A");
    assert.equal(episodeIdFor(third, [first, { ...second, episodeId: b }]), "A");
    assert.equal(episodeIdFor(later, [first, { ...second, episodeId: b }, { ...third, episodeId: "A" }]), "D");
    assert.equal(episodeIdFor(otherWay, [first]), "E");
    assert.equal(sessionNameOf("2026-10-02-BTC-16"), "BTC-16");
    assert.equal(sessionNameOf("LONDON"), "LONDON");
  });
});

function full(bar: { t: number; h: number; l: number }) {
  return { t: bar.t, o: bar.l, h: bar.h, l: bar.l, c: bar.l, v: 1 };
}

function paperOf(row: { direction: "COMPRA" | "VENTA"; entry: number; stop: number; target: number; lastBarT: number }) {
  return {
    id: "t",
    asset: "XAUUSD" as const,
    timeframe: "15m" as const,
    timestamp: row.lastBarT + 900,
    lastBarT: row.lastBarT,
    direction: row.direction,
    entry: row.entry,
    stop: row.stop,
    target: row.target,
    rr: 1,
    setup: "FAILED_BREAKOUT",
    tier: "FULL" as const,
    marketState: "RANGE",
    event: "FAILED_BREAKOUT_DOWN",
    rationale: "",
    provider: "test",
    revisionOf: null,
    result: "ABIERTA" as const,
  };
}
