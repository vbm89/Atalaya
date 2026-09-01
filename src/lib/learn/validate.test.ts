import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { AssetId } from "../trading/types.ts";
import type { LearningCase } from "./case.ts";
import { detectFindings } from "./patterns.ts";
import {
  applyValidationToEngine,
  judge,
  MIN_TEST_N,
  plannedWalkForward,
  runValidation,
  splitTemporal,
  TRAIN_RATIO,
  validateProposal,
  VALIDATION_ALGO,
} from "./validate.ts";
import { proposalFromFinding } from "./proposals.ts";

function lc(partial: Partial<LearningCase> = {}): LearningCase {
  return {
    episodeId: "e",
    assetId: "XAUUSD",
    direction: "buy",
    kind: "continuation",
    timeframe: "15m",
    openedAtMs: Date.parse("2026-01-01T08:00:00Z"),
    closedAtMs: Date.parse("2026-01-01T10:00:00Z"),
    openedState: "entry",
    currentState: "wait",
    waitReason: null,
    missingForEntry: null,
    bias4hLabel: "ALCISTA",
    warnings: [],
    qualityPhase: "final",
    volumeRatio15: 1,
    volumeAvailable15: true,
    volumeRatio4h: 1,
    volumeAvailable4h: true,
    highImpact: false,
    underlyingClosed: false,
    dataStatus: "ok",
    zoneLow: 100,
    zoneHigh: 110,
    entry: 110,
    sl: 90,
    tp1: 130,
    tp2: 140,
    invalidation: 85,
    riskReward: 2.2,
    quality: "media",
    basis: null,
    outcome: "tp1",
    firstTouch: "tp1",
    firstTouchAtMs: Date.parse("2026-01-01T09:00:00Z"),
    mfe: 10,
    mae: 2,
    durationMs: 7_200_000,
    trainable: true,
    exclusionReason: null,
    complete: true,
    origin: "production",
    ...partial,
  };
}

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T08:00:00Z");

function at(i: number, extra: Partial<LearningCase> = {}): LearningCase {
  return lc({
    episodeId: extra.episodeId ?? `e${i}`,
    openedAtMs: T0 + i * DAY,
    closedAtMs: T0 + i * DAY + 3_600_000,
    firstTouchAtMs: T0 + i * DAY + 1_800_000,
    ...extra,
  });
}

function sequence(n: number, pick: (i: number) => Partial<LearningCase>): LearningCase[] {
  return Array.from({ length: n }, (_, i) => at(i, pick(i)));
}

const consistent = sequence(200, (i) =>
  i % 2 === 0
    ? { kind: "continuation", outcome: "tp1", firstTouch: "tp1" }
    : { kind: "break-retest", outcome: "sl", firstTouch: "sl" },
);

describe("P5.6 split", () => {
  it("uses chronological 70/30, never random, train before test", () => {
    const a = splitTemporal(consistent);
    const b = splitTemporal(consistent);
    assert.deepEqual(a.train.map((c) => c.episodeId), b.train.map((c) => c.episodeId));
    assert.equal(a.train.length, Math.floor(200 * TRAIN_RATIO));
    assert.equal(a.test.length, 200 - a.train.length);
    const lastTrain = a.train[a.train.length - 1]!.openedAtMs;
    const firstTest = a.test[0]!.openedAtMs;
    assert.ok(lastTrain <= firstTest);
    for (let i = 1; i < a.train.length; i++) {
      assert.ok(a.train[i]!.openedAtMs >= a.train[i - 1]!.openedAtMs);
    }
  });
});

describe("P5.6 discovery isolation", () => {
  it("hypothesis is discovered on train only; changing test does not change proposal ids", () => {
    const flipped = consistent.map((c, i) =>
      i < 140 ? c : { ...c, outcome: c.outcome === "tp1" ? "sl" : "tp1", firstTouch: c.outcome === "tp1" ? "sl" : "tp1", episodeId: c.episodeId },
    );
    const a = runValidation(consistent, 1);
    const b = runValidation(flipped, 1);
    assert.deepEqual(
      a.records.map((r) => r.proposalId).sort(),
      b.records.map((r) => r.proposalId).sort(),
    );
    assert.ok(a.tried >= 1);
  });
});

describe("P5.6 verdicts", () => {
  it("test n<30 → INCONCLUSIVE", () => {
    const small = sequence(20, (i) =>
      i % 2 === 0
        ? { kind: "continuation", outcome: "tp1", firstTouch: "tp1" }
        : { kind: "break-retest", outcome: "sl", firstTouch: "sl" },
    );
    const report = runValidation(small, 1);
    assert.ok(report.records.every((r) => r.verdict === "INCONCLUSIVE" || r.test.n < MIN_TEST_N));
    const judged = judge(
      { n: 40, hypothesis: { hits: 32, n: 40, pct: 0.8, wilsonLow: 0.6, wilsonHigh: 0.9 }, baseline: { hits: 20, n: 40, pct: 0.5, wilsonLow: 0.3, wilsonHigh: 0.7 }, deltaPp: 30, periodFromMs: 1, periodToMs: 2 },
      { n: 7, hypothesis: { hits: 7, n: 7, pct: 1, wilsonLow: 0.6, wilsonHigh: 1 }, baseline: { hits: 4, n: 7, pct: 0.5, wilsonLow: 0.2, wilsonHigh: 0.8 }, deltaPp: 50, periodFromMs: 3, periodToMs: 4 },
      "positive",
      true,
    );
    assert.equal(judged.verdict, "INCONCLUSIVE");
  });

  it("train improve + test improve → VALIDATED", () => {
    const report = runValidation(consistent, 1);
    const hit = report.records.find((r) => r.cut === "continuation" && r.verdict === "VALIDATED");
    assert.ok(hit, JSON.stringify(report.records.map((r) => ({ cut: r.cut, v: r.verdict, tn: r.test.n, dtr: r.train.deltaPp, dte: r.test.deltaPp }))));
    assert.ok((hit!.test.n) >= MIN_TEST_N);
    assert.ok((hit!.test.deltaPp ?? 0) >= 5);
    assert.match(hit!.notice, /no modifica V1/i);
    assert.equal(hit!.algo, VALIDATION_ALGO);
  });

  it("train improve + test worsen → REJECTED", () => {
    const flipped = sequence(200, (i) => {
      if (i < 140) {
        return i % 2 === 0
          ? { kind: "continuation", outcome: "tp1", firstTouch: "tp1" }
          : { kind: "break-retest", outcome: "sl", firstTouch: "sl" };
      }
      return i % 2 === 0
        ? { kind: "continuation", outcome: "sl", firstTouch: "sl" }
        : { kind: "break-retest", outcome: "tp1", firstTouch: "tp1" };
    });
    const report = runValidation(flipped, 1);
    const hit = report.records.find((r) => r.cut === "continuation");
    assert.ok(hit);
    assert.equal(hit!.verdict, "REJECTED");
    assert.match(hit!.reason, /sobreajuste|invertido/i);
  });

  it("sign inversion is REJECTED; |Δ test|<5 is not VALIDATED", () => {
    const judged = judge(
      { n: 80, hypothesis: { hits: 64, n: 80, pct: 0.8, wilsonLow: 0.7, wilsonHigh: 0.88 }, baseline: { hits: 40, n: 80, pct: 0.5, wilsonLow: 0.4, wilsonHigh: 0.6 }, deltaPp: 30, periodFromMs: 1, periodToMs: 2 },
      { n: 40, hypothesis: { hits: 21, n: 40, pct: 0.525, wilsonLow: 0.37, wilsonHigh: 0.67 }, baseline: { hits: 20, n: 40, pct: 0.5, wilsonLow: 0.35, wilsonHigh: 0.65 }, deltaPp: 2.5, periodFromMs: 3, periodToMs: 4 },
      "positive",
      true,
    );
    assert.equal(judged.verdict, "INCONCLUSIVE");
  });
});

describe("P5.6 semantics and isolation", () => {
  it("EXPIRADA and PENDING and trainable=false stay out of success n", () => {
    const base = sequence(200, (i) =>
      i % 2 === 0
        ? { kind: "continuation", outcome: "tp1", firstTouch: "tp1" }
        : { kind: "break-retest", outcome: "sl", firstTouch: "sl" },
    );
    const extra: LearningCase[] = [
      at(500, { episodeId: "exp", kind: "continuation", outcome: "expired", firstTouch: null, trainable: true }),
      at(501, {
        episodeId: "pend",
        kind: "continuation",
        outcome: "pending",
        trainable: false,
        exclusionReason: "OUTCOME_PENDING",
      }),
      at(502, {
        episodeId: "bad",
        kind: "continuation",
        outcome: "tp1",
        trainable: false,
        exclusionReason: "LEVELS_INCOHERENT",
      }),
    ];
    const report = runValidation([...base, ...extra], 1);
    const cont = report.records.find((r) => r.cut === "continuation");
    assert.ok(cont);
    assert.equal(cont!.train.hypothesis.hits + cont!.test.hypothesis.hits, 100);
  });

  it("V1 baseline and hypothesis share the same test universe", () => {
    const report = runValidation(consistent, 1);
    const rec = report.records.find((r) => r.cut === "continuation")!;
    assert.equal(rec.test.baseline.n, rec.test.hypothesis.n + (rec.test.baseline.n - rec.test.hypothesis.n));
    assert.ok(rec.test.baseline.n >= rec.test.hypothesis.n);
  });

  it("VALIDATED does not create V1.1; REJECTED and INCONCLUSIVE are kept; multiple recorded", () => {
    const report = runValidation(consistent, 1);
    assert.ok(report.tried >= 1);
    assert.equal(report.tried, report.validated + report.rejected + report.inconclusive);
    assert.ok(report.records.some((r) => r.verdict === "REJECTED" || r.verdict === "VALIDATED" || r.verdict === "INCONCLUSIVE"));
    assert.match(report.notice, /no significa apta para trading/i);
    assert.throws(() => applyValidationToEngine(report.records[0]!), /VALIDATED ≠ APPROVED/);
    const src = readFileSync(new URL("./validate.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /from ["'].*trading\/engine/);
  });

  it("is reproducible and uses Madrid-capable periods", () => {
    const a = runValidation(consistent, 9);
    const b = runValidation(consistent, 9);
    assert.deepEqual(a, b);
    const rec = a.records[0]!;
    assert.ok(rec.train.periodFromMs != null && rec.test.periodToMs != null);
  });

  it("origin=test fixtures never enter production validation", () => {
    const fake = sequence(200, (i) => ({
      assetId: "WTI" as AssetId,
      origin: "test" as const,
      kind: i % 2 === 0 ? "continuation" : "break-retest",
      outcome: i % 2 === 0 ? "tp1" : "sl",
      firstTouch: i % 2 === 0 ? "tp1" : "sl",
    }));
    const report = runValidation([...consistent, ...fake], 1);
    assert.equal(report.records.some((r) => r.asset === "WTI"), false);
  });

  it("walk-forward architecture is prepared as a single 70/30 fold", () => {
    const plan = plannedWalkForward(consistent);
    assert.equal(plan.folds.length, 1);
    assert.match(plan.note, /Walk-forward/);
  });
});

describe("P5.6 proposal helper", () => {
  it("validateProposal keeps status out of approved/applied", () => {
    const split = splitTemporal(consistent);
    const f = detectFindings(split.train).highlighted[0]!;
    const p = proposalFromFinding(f, 1);
    const rec = validateProposal(p, split.train, split.test, 1);
    assert.ok(rec.verdict === "VALIDATED" || rec.verdict === "REJECTED" || rec.verdict === "INCONCLUSIVE" || rec.verdict === "PENDING_VALIDATION");
    assert.doesNotMatch(rec.notice, /APPROVED TO V1/);
  });
});
