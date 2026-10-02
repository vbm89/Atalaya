import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { settleSignal } from "../learn/price-behaviour/journal.ts";
import { appendSettle, appendSignal, readSignals, type StoredSignal } from "./store.ts";
import { excursionR } from "./study.ts";

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
