import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildK1Report,
  K1_REGISTERED_AT,
  scanK1BreakoutEvents,
  scanK1FailedBreakout,
  type K1Bar,
  type K1Report,
} from "./shadow-k1-failed-breakout.ts";

const BAR = 900;

function bar(t: number, o: number, h: number, l: number, c: number, assetId = "XAUUSD"): K1Bar {
  return { assetId, t, o, h, l, c };
}

function rangeBars(start = 0, assetId = "XAUUSD"): K1Bar[] {
  const rows: K1Bar[] = [];
  for (let i = 0; i < 20; i += 1) rows.push(bar(start + i * BAR, 100, 101, 99, 100, assetId));
  return rows;
}

/** A = breakout at index 20. */
function breakoutA(start = 0, assetId = "XAUUSD"): K1Bar {
  return bar(start + 20 * BAR, 100, 101.4, 100, 101.3, assetId);
}

/** B = second close still outside the origin range. */
function stillOutB(start = 0, assetId = "XAUUSD"): K1Bar {
  return bar(start + 21 * BAR, 101.3, 101.6, 101.1, 101.3, assetId);
}

/** Reclaim back inside origin range. Default at index 21 (A then C). */
function reclaimAt(start: number, index: number, assetId = "XAUUSD", high = 101.2, low = 100.8, close = 100.5): K1Bar {
  return bar(start + index * BAR, 101.3, high, low, close, assetId);
}

function ac(start = 0, assetId = "XAUUSD"): K1Bar[] {
  return [...rangeBars(start, assetId), breakoutA(start, assetId), reclaimAt(start, 21, assetId)];
}

function abc(start = 0, assetId = "XAUUSD"): K1Bar[] {
  return [
    ...rangeBars(start, assetId),
    breakoutA(start, assetId),
    stillOutB(start, assetId),
    reclaimAt(start, 22, assetId),
  ];
}

function timeoutThenLaterCandidate(start = 0, assetId = "XAUUSD"): K1Bar[] {
  const rows = [...rangeBars(start, assetId), breakoutA(start, assetId)];
  for (let i = 21; i <= 24; i += 1) {
    rows.push(bar(start + i * BAR, 101.3, 101.4, 101.25, 101.3, assetId));
  }
  rows.push(bar(start + 25 * BAR, 101.5, 102.2, 101.5, 102.0, assetId));
  rows.push(bar(start + 26 * BAR, 102.0, 102.0, 100.8, 100.5, assetId));
  rows.push(bar(start + 27 * BAR, 100.5, 101, 99, 100, assetId));
  return rows;
}

function publicTrainFields(report: K1Report) {
  return {
    candidates: report.candidates,
    uniqueBreakoutEvents: report.uniqueBreakoutEvents,
    breakoutEventDispositions: report.breakoutEventDispositions,
    decided: report.decided,
    tp1: report.tp1,
    sl: report.sl,
    pending: report.pending,
    expired: report.expired,
    successPct: report.successPct,
    meanGrossR: report.meanGrossR,
    train: report.train,
    fillModels: report.fillModels,
    path: report.path,
    test: report.test,
    registeredAt: report.registeredAt,
  };
}

describe("K1 failed breakout / trap", () => {
  it("A: A+B+C is one event, one candidate, origin A, decision C", () => {
    const rows = abc();
    const events = scanK1BreakoutEvents(rows);
    const candidates = scanK1FailedBreakout(rows);
    assert.equal(events.length, 1);
    assert.equal(candidates.length, 1);
    assert.equal(events[0]!.disposition, "candidate");
    assert.equal(candidates[0]!.breakoutSlot, 20 * BAR + BAR);
    assert.equal(candidates[0]!.decisionSlot, 22 * BAR + BAR);
    assert.equal(candidates[0]!.direction, "sell");
    const report = buildK1Report({ XAUUSD: rows });
    assert.equal(report.candidates, 1);
    assert.equal(report.uniqueBreakoutEvents, 1);
    assert.equal(report.breakoutEventDispositions.candidate, 1);
  });

  it("B: risk veto consumes the event and B does not reopen it", () => {
    const start = 0;
    const rows = [
      ...rangeBars(start),
      breakoutA(start),
      stillOutB(start),
      reclaimAt(start, 22, "XAUUSD", 106, 100.4, 100.5),
    ];
    const events = scanK1BreakoutEvents(rows);
    assert.equal(scanK1FailedBreakout(rows).length, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.disposition, "risk_veto");
    assert.equal(events[0]!.breakoutSlot, 20 * BAR + BAR);
    const report = buildK1Report({ XAUUSD: rows });
    assert.equal(report.candidates, 0);
    assert.equal(report.uniqueBreakoutEvents, 1);
    assert.equal(report.breakoutEventDispositions.risk_veto, 1);
  });

  it("C: four bars without reclaim is timeout; a later breakout is a second event", () => {
    const onlyTimeout = timeoutThenLaterCandidate().filter((row) => row.t <= 24 * BAR);
    const timeoutEvents = scanK1BreakoutEvents(onlyTimeout);
    assert.equal(timeoutEvents.length, 1);
    assert.equal(timeoutEvents[0]!.disposition, "timeout");
    assert.equal(scanK1FailedBreakout(onlyTimeout).length, 0);

    const rows = timeoutThenLaterCandidate();
    const events = scanK1BreakoutEvents(rows);
    assert.equal(events.length, 2);
    assert.equal(events[0]!.disposition, "timeout");
    assert.equal(events[1]!.disposition, "candidate");
    assert.notEqual(events[0]!.breakoutSlot, events[1]!.breakoutSlot);
    assert.equal(scanK1FailedBreakout(rows).length, 1);
  });

  it("does not count an incomplete right-edge breakout as timeout", () => {
    const start = 0;
    const rows = [
      ...rangeBars(start),
      breakoutA(start),
      bar(start + 21 * BAR, 101.3, 101.4, 101.25, 101.3),
      bar(start + 22 * BAR, 101.3, 101.4, 101.25, 101.3),
    ];
    const events = scanK1BreakoutEvents(rows);
    assert.equal(events.length, 0);
    assert.equal(scanK1FailedBreakout(rows).length, 0);
    const report = buildK1Report({ XAUUSD: rows });
    assert.equal(report.uniqueBreakoutEvents, 0);
    assert.equal(report.breakoutEventDispositions.timeout, 0);
  });

  it("D: the same pattern on two assets is two independent events", () => {
    const report = buildK1Report({ XAUUSD: abc(0, "XAUUSD"), BTCUSD: abc(0, "BTCUSD") });
    assert.equal(report.candidates, 2);
    assert.equal(report.uniqueBreakoutEvents, 2);
    const events = [...scanK1BreakoutEvents(abc(0, "XAUUSD")), ...scanK1BreakoutEvents(abc(0, "BTCUSD"))];
    assert.deepEqual(new Set(events.map((event) => event.assetId)), new Set(["XAUUSD", "BTCUSD"]));
  });

  it("E: a new breakout after A+B+C is a second event", () => {
    const start = 0;
    const rows = [
      ...abc(start),
      bar(start + 23 * BAR, 100.5, 102.0, 101.7, 102.0),
      bar(start + 24 * BAR, 102.0, 102.0, 100.8, 100.5),
      bar(start + 25 * BAR, 100.5, 101, 99, 100),
    ];
    const events = scanK1BreakoutEvents(rows);
    assert.equal(events.length, 2);
    assert.equal(events.filter((event) => event.disposition === "candidate").length, 2);
    assert.notEqual(events[0]!.breakoutSlot, events[1]!.breakoutSlot);
    assert.equal(scanK1FailedBreakout(rows).length, 2);
  });

  it("F: tape ending on the decision candle is pending, not expired", () => {
    const rows = ac();
    const candidate = scanK1FailedBreakout(rows)[0]!;
    assert.ok(rows.every((row) => row.t < candidate.decisionSlot));
    const report = buildK1Report({ XAUUSD: rows });
    assert.equal(report.pending, 1);
    assert.equal(report.decided, 0);
    assert.equal(report.expired, 0);
    assert.equal(report.meanGrossR, null);
    assert.equal(report.test.hidden, true);
  });

  it("G: the next closed bar hitting SL is decided", () => {
    const prefix = ac();
    const candidate = scanK1FailedBreakout(prefix)[0]!;
    const slBar = bar(candidate.decisionSlot, candidate.entry, candidate.sl + 0.1, candidate.entry - 0.2, candidate.entry);
    const report = buildK1Report({ XAUUSD: [...prefix, slBar] });
    assert.equal(report.decided, 1);
    assert.equal(report.sl, 1);
    assert.equal(report.pending, 0);
    assert.equal(report.meanGrossR, -1);
  });

  it("H: Touch SL then Close-through TP1 is discordant, not a winner pick", () => {
    const prefix = ac();
    const candidate = scanK1FailedBreakout(prefix)[0]!;
    const wickSl = bar(
      candidate.decisionSlot,
      candidate.entry,
      candidate.sl + 0.1,
      candidate.tp1 + 0.4,
      (candidate.entry + candidate.tp1) / 2,
    );
    const closeTp1 = bar(
      candidate.decisionSlot + BAR,
      candidate.entry,
      candidate.entry,
      candidate.tp1 - 1,
      candidate.tp1 - 0.4,
    );
    const report = buildK1Report({ XAUUSD: [...prefix, wickSl, closeTp1] });
    assert.equal(report.candidates, 1);
    assert.equal(report.fillModels.touchExpectancyR, -1);
    assert.equal(report.fillModels.closeThroughExpectancyR, 2);
    assert.equal(report.fillModels.touchSl_ctTp1, 1);
    assert.equal(report.fillModels.discordantCount, 1);
    assert.equal(report.meanGrossR, -1);
  });

  it("I: Touch TP1 then Close-through SL is the inverse discordance", () => {
    const prefix = ac();
    const candidate = scanK1FailedBreakout(prefix)[0]!;
    const wickTp1 = bar(
      candidate.decisionSlot,
      candidate.entry,
      candidate.sl - 0.2,
      candidate.tp1 - 0.1,
      candidate.entry - 0.2,
    );
    const closeSl = bar(
      candidate.decisionSlot + BAR,
      candidate.entry,
      candidate.sl + 0.4,
      candidate.entry,
      candidate.sl + 0.2,
    );
    const report = buildK1Report({ XAUUSD: [...prefix, wickTp1, closeSl] });
    assert.equal(report.fillModels.touchExpectancyR, 2);
    assert.equal(report.fillModels.closeThroughExpectancyR, -1);
    assert.equal(report.fillModels.touchTp1_ctSl, 1);
    assert.equal(report.meanGrossR, 2);
  });

  it("J: Touch and Close-through share the same candidate identities", () => {
    const rows = abc();
    const candidates = scanK1FailedBreakout(rows);
    const events = scanK1BreakoutEvents(rows);
    assert.equal(candidates.length, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.candidate!.breakoutSlot, candidates[0]!.breakoutSlot);
    assert.equal(events[0]!.candidate!.decisionSlot, candidates[0]!.decisionSlot);
    assert.equal(events[0]!.candidate!.assetId, candidates[0]!.assetId);
    const report = buildK1Report({ XAUUSD: rows });
    assert.equal(report.fillModels.touchDecided + report.pending, report.candidates);
  });

  it("K: decisionSlot just before registeredAt is TRAIN; equal is TEST", () => {
    const trainStart = K1_REGISTERED_AT - 1 - 22 * BAR;
    const testStart = K1_REGISTERED_AT - 22 * BAR;
    const trainRows = ac(trainStart);
    const testRows = ac(testStart, "BTCUSD");
    assert.equal(scanK1FailedBreakout(trainRows)[0]!.decisionSlot, K1_REGISTERED_AT - 1);
    assert.equal(scanK1FailedBreakout(testRows)[0]!.decisionSlot, K1_REGISTERED_AT);

    const trainReport = buildK1Report({ XAUUSD: trainRows }, false);
    assert.equal(trainReport.train.n, 1);
    assert.equal(trainReport.test.hidden, true);
    assert.equal("n" in trainReport.test, false);

    const sealed = buildK1Report({ XAUUSD: trainRows, BTCUSD: testRows }, true);
    assert.equal(sealed.train.n, 1);
    assert.equal(sealed.test.hidden, false);
    if (sealed.test.hidden) throw new Error("expected revealed TEST");
    assert.equal(sealed.test.n, 1);
    assert.equal(sealed.candidates, 1);
    assert.equal(sealed.meanGrossR, sealed.train.expectancyR);
  });

  it("L: REGISTERED test payload is exactly {hidden:true} and public metrics ignore TEST tape", () => {
    const trainRows = ac(0, "XAUUSD");
    const testRows = ac(K1_REGISTERED_AT, "BTCUSD");
    const before = buildK1Report({ XAUUSD: trainRows }, false);
    const after = buildK1Report({ XAUUSD: trainRows, BTCUSD: testRows }, false);
    assert.deepEqual(after.test, { hidden: true });
    assert.equal(JSON.stringify(after.test), '{"hidden":true}');
    assert.deepEqual(publicTrainFields(after), publicTrainFields(before));
  });

  it("M: adding post-registration bars does not change TRAIN identities or TRAIN stats", () => {
    const trainRows = ac(0, "XAUUSD");
    const testRows = abc(K1_REGISTERED_AT, "BTCUSD");
    const before = buildK1Report({ XAUUSD: trainRows }, false);
    const after = buildK1Report({ XAUUSD: trainRows, BTCUSD: testRows }, false);
    const beforeIds = scanK1FailedBreakout(trainRows).map((c) => `${c.assetId}|${c.direction}|${c.breakoutSlot}|${c.decisionSlot}`);
    const afterTrainIds = scanK1FailedBreakout(trainRows).map((c) => `${c.assetId}|${c.direction}|${c.breakoutSlot}|${c.decisionSlot}`);
    assert.deepEqual(afterTrainIds, beforeIds);
    assert.equal(after.train.n, before.train.n);
    assert.equal(after.train.decided, before.train.decided);
    assert.equal(after.train.expectancyR, before.train.expectancyR);
    assert.equal(after.train.successPct, before.train.successPct);
    assert.deepEqual(after.fillModels, before.fillModels);
    assert.deepEqual(after.path, before.path);
    const revealed = buildK1Report({ XAUUSD: trainRows, BTCUSD: testRows }, true);
    assert.equal(revealed.train.n, before.train.n);
    assert.equal(revealed.meanGrossR, before.meanGrossR);
    assert.equal(revealed.registeredAt, K1_REGISTERED_AT);
    if (revealed.test.hidden) throw new Error("expected revealed TEST");
    assert.equal(revealed.test.n, 1);
  });

  it("N: uniqueBreakoutEvents counts events, not candidates", () => {
    const rows = timeoutThenLaterCandidate();
    const report = buildK1Report({ XAUUSD: rows });
    assert.equal(report.uniqueBreakoutEvents, 2);
    assert.equal(report.candidates, 1);
    assert.equal(report.breakoutEventDispositions.timeout, 1);
    assert.equal(report.breakoutEventDispositions.candidate, 1);
    assert.notEqual(report.uniqueBreakoutEvents, report.candidates);
  });

  it("O: mutating bars after decisionSlot cannot change the candidate", () => {
    const prefix = abc();
    const baseline = scanK1FailedBreakout(prefix)[0]!;
    const tpFuture = bar(baseline.decisionSlot, 98, 99, 90, 91);
    const slFuture = bar(baseline.decisionSlot, 100, 110, 99, 109);
    const afterTp = scanK1FailedBreakout([...prefix, tpFuture])[0]!;
    const afterSl = scanK1FailedBreakout([...prefix, slFuture])[0]!;
    for (const got of [afterTp, afterSl]) {
      assert.equal(got.breakoutSlot, baseline.breakoutSlot);
      assert.equal(got.decisionSlot, baseline.decisionSlot);
      assert.equal(got.entry, baseline.entry);
      assert.equal(got.sl, baseline.sl);
      assert.equal(got.tp1, baseline.tp1);
      assert.equal(got.risk, baseline.risk);
      assert.equal(got.direction, baseline.direction);
    }
  });

  it("keeps costs unknown, geometry frozen, and never uses a moving 80/20 cut", () => {
    assert.equal(K1_REGISTERED_AT, Math.floor(Date.parse("2026-09-12T06:30:00Z") / 1000));
    const report = buildK1Report({ XAUUSD: abc() });
    assert.equal(report.netExpectancyR, null);
    assert.equal(report.costsKnown, false);
    assert.equal(report.expired, 0);
    assert.equal(report.parameters.tp1R, 2);
    assert.equal(report.parameters.tp2R, null);
    assert.equal(report.parameters.maxFailureBars, 4);
    assert.equal(report.parameters.rangeLookbackBars, 16);
    assert.equal(report.parameters.volumeFilter, false);
    assert.equal(report.train.n, report.candidates);
    assert.equal(report.train.decided, report.decided);
    assert.equal(report.train.expectancyR, report.meanGrossR);
    assert.equal(report.train.successPct, report.successPct);
  });
});
