import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bar } from "../learn/price-behaviour/types.ts";
import { appendSettle, appendSignal, readSignals } from "./store.ts";
import type { StoredSignal } from "./store.ts";
import { captureStudy, measuredFlag, renderStudyReport, resultROf, STUDY_MIN_N } from "./study.ts";

function bars(n: number, step = 1): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const c = 100 + i * step;
    out.push({ t: 1_700_000_000 + i * 900, o: c - step, h: c + 0.2, l: c - 0.4, c, v: 1 });
  }
  return out;
}

function signal(partial: Partial<StoredSignal> & Pick<StoredSignal, "asset" | "timestamp" | "result" | "RR">): StoredSignal {
  return {
    kind: "signal",
    signalId: `${partial.asset}|${partial.timestamp}`,
    timeframe: "15m",
    provider: "test",
    lastBarT: partial.timestamp - 900,
    direction: "VENTA",
    entry: 1,
    stop: 2,
    target: 0,
    setup: "FAILED_BREAKOUT",
    marketState: "RANGE",
    event: "FAILED_BREAKOUT_UP",
    confirmation: true,
    evidence: {},
    rationale: "",
    createdAt: partial.timestamp,
    tier: "PARTIAL",
    revisionOf: null,
    ...partial,
  };
}

  it("writes result R when a paper signal settles", () => {
    const root = mkdtempSync(join(tmpdir(), "paper-study-"));
    const row = signal({ asset: "US100", timestamp: 1_700_000_900, result: "ABIERTA", RR: 2.5 });
    row.study = {
      h1: "DOWN",
      h4: "FLAT",
      marketState: row.marketState,
      event: row.event,
      setup: row.setup,
      tier: row.tier,
      direction: "SHORT",
      rr: row.RR,
      atr: 1,
      riskAtr: 1.2,
      displacement: false,
      reclaim: true,
      location: true,
      structure: true,
      confirmation: true,
      hourUtc: 12,
      session: "x",
      entry: row.entry,
      stop: row.stop,
      target: row.target,
      resultR: null,
    };
    row.resultR = null;
    appendSignal(root, row);
    appendSettle(root, row.signalId, "TP", 1_700_001_000);
    const stored = readSignals(root)[0]!;
    assert.equal(stored.result, "TP");
    assert.equal(stored.resultR, 2.5);
    assert.equal(stored.study?.resultR, 2.5);
  });
  it("records closed-bar context and does not invent a result", () => {
    const tape = bars(80, 0.5);
    const study = captureStudy(tape, {
      asset: "US100",
      lastBarT: tape[tape.length - 1]!.t,
      marketState: "TREND_UP",
      event: "BREAKOUT_UP",
      setup: "BREAKOUT_ACCEPTANCE",
      tier: "FULL",
      direction: "LONG",
      rr: 1.8,
      entry: 140,
      stop: 138,
      target: 143.6,
      confirmation: true,
      evidence: { displacement: true, reclaim: false, location: true, structure: true },
    });
    assert.equal(study.h1, "UP");
    assert.equal(study.h4, "UP");
    assert.equal(study.marketState, "TREND_UP");
    assert.equal(study.tier, "FULL");
    assert.equal(study.displacement, true);
    assert.equal(study.reclaim, false);
    assert.ok(study.atr != null && study.atr > 0);
    assert.ok(study.riskAtr != null && study.riskAtr > 0);
    assert.equal(study.hourUtc, new Date((tape.at(-1)!.t + 900) * 1000).getUTCHours());
    assert.match(study.session ?? "", /NEW_YORK|LONDON|ASIA|OFF/);
    assert.equal(study.sessionName, (study.session ?? "").replace(/^\d{4}-\d{2}-\d{2}-/, ""));
    assert.equal(study.episodeId, null);
    assert.equal(study.exitBarT, null);
    assert.equal(study.resultR, null);
    assert.equal(resultROf("SL", 1.8), -1);
    assert.equal(resultROf("TP", 1.8), 1.8);
    assert.equal(resultROf("ABIERTA", 1.8), null);
  });

  it("keeps a missing evidence flag as null and a measured false as false", () => {
    const tape = bars(80, 0.5);
    const study = captureStudy(tape, {
      asset: "WTI",
      lastBarT: tape[tape.length - 1]!.t,
      marketState: "REVERSAL_ATTEMPT",
      event: "FAILED_BREAKOUT_DOWN",
      setup: "FAILED_BREAKOUT",
      tier: "PARTIAL",
      direction: "LONG",
      rr: 2.1,
      entry: 70,
      stop: 69,
      target: 72.1,
      confirmation: true,
      evidence: { structure: true, location: true, confirmation: true, partial: true },
    });
    assert.equal(study.displacement, null);
    assert.equal(study.reclaim, null);
    assert.equal(study.location, true);
    assert.equal(study.structure, true);
    assert.equal(study.confirmation, true);
    assert.equal(measuredFlag({ displacement: false }, "displacement"), false);
    assert.equal(measuredFlag({}, "displacement"), null);
  });

  it("hides cells below the minimum and keeps train/test plus weeks", () => {
    const rows: StoredSignal[] = [];
    for (let i = 0; i < 3; i++) {
      rows.push(signal({ asset: "BTCUSD", timestamp: 1_700_000_000 + i * 900, result: "SL", RR: 2 }));
    }
    const small = renderStudyReport(rows);
    assert.match(small, /Ninguna celda alcanza el mínimo/);
    assert.ok(STUDY_MIN_N > 3);

    const many: StoredSignal[] = [];
    for (let i = 0; i < 10; i++) {
      many.push(
        signal({
          asset: "WTI",
          timestamp: 1_700_000_000 + i * 86_400,
          result: i < 8 ? "SL" : "TP",
          RR: 2,
          setup: "BREAKOUT_ACCEPTANCE",
        }),
      );
    }
    const report = renderStudyReport(many);
    assert.match(report, /### MUESTRA/);
    assert.match(report, /### TRAIN/);
    assert.match(report, /### TEST/);
    assert.match(report, /setup:BREAKOUT_ACCEPTANCE/);
    assert.match(report, /No es una regla/);
  });
