import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetId } from "../trading/types.ts";
import type { LearningCase } from "./case.ts";
import { detectFindings, isHighlighted, MIN_DELTA_PP, productionCases } from "./patterns.ts";
import { evidenceLevel } from "./stats.ts";

function lc(partial: Partial<LearningCase> = {}): LearningCase {
  return {
    episodeId: partial.episodeId ?? "e",
    assetId: "XAUUSD",
    direction: "buy",
    kind: "continuation",
    timeframe: "15m",
    openedAtMs: Date.parse("2026-03-01T08:00:00Z"),
    closedAtMs: Date.parse("2026-03-01T10:00:00Z"),
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
    firstTouchAtMs: Date.parse("2026-03-01T09:00:00Z"),
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

function pack(
  n: number,
  outcome: "tp1" | "sl" | "tp2" | "expired",
  extra: Partial<LearningCase>,
): LearningCase[] {
  return Array.from({ length: n }, (_, i) =>
    lc({
      episodeId: `${extra.assetId ?? "XAUUSD"}-${extra.kind ?? "k"}-${extra.direction ?? "d"}-${outcome}-${i}`,
      outcome,
      firstTouch: outcome === "expired" ? null : outcome,
      openedAtMs: Date.parse("2026-03-01T08:00:00Z") + i * 86_400_000,
      ...extra,
    }),
  );
}

describe("P5.4 evidence and delta", () => {
  it("n<20 → evidencia insuficiente", () => {
    const cases = [...pack(10, "tp1", { kind: "continuation" }), ...pack(10, "sl", { kind: "break-retest" })];
    const f = detectFindings(cases).findings.find((x) => x.assetId === "XAUUSD" && x.cut === "continuation")!;
    assert.equal(f.groupN, 10);
    assert.equal(f.evidence, "insufficient");
    assert.equal(isHighlighted(f), false);
  });

  it("n=20 with ≥5pp → observación", () => {
    const cases = [
      ...pack(16, "tp1", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
      ...pack(8, "tp1", { kind: "break-retest" }),
      ...pack(12, "sl", { kind: "break-retest" }),
    ];
    const f = detectFindings(cases).highlighted.find((x) => x.cut === "continuation")!;
    assert.equal(f.groupN, 20);
    assert.equal(f.evidence, "observation");
    assert.ok((f.deltaPp ?? 0) >= MIN_DELTA_PP);
  });

  it("n=50 with ≥5pp → patrón potencial", () => {
    const cases = [
      ...pack(40, "tp1", { kind: "continuation" }),
      ...pack(10, "sl", { kind: "continuation" }),
      ...pack(25, "tp1", { kind: "break-retest" }),
      ...pack(25, "sl", { kind: "break-retest" }),
    ];
    const f = detectFindings(cases).highlighted.find((x) => x.cut === "continuation")!;
    assert.equal(f.groupN, 50);
    assert.equal(f.evidence, "potential_pattern");
  });

  it("n=80 with ≥5pp → evidencia más sólida, not V1.1", () => {
    const cases = [
      ...pack(64, "tp1", { kind: "continuation" }),
      ...pack(16, "sl", { kind: "continuation" }),
      ...pack(40, "tp1", { kind: "break-retest" }),
      ...pack(40, "sl", { kind: "break-retest" }),
    ];
    const f = detectFindings(cases).highlighted.find((x) => x.cut === "continuation")!;
    assert.equal(f.groupN, 80);
    assert.equal(evidenceLevel(80), "stronger");
    assert.ok(f.evidence === "stronger" || f.evidence === "potential_pattern");
    assert.match(f.notice, /No modifica V1/);
  });

  it("difference <5pp is not highlighted", () => {
    const cases = [
      ...pack(26, "tp1", { kind: "continuation" }),
      ...pack(24, "sl", { kind: "continuation" }),
      ...pack(25, "tp1", { kind: "break-retest" }),
      ...pack(25, "sl", { kind: "break-retest" }),
    ];
    const f = detectFindings(cases).findings.find((x) => x.cut === "continuation")!;
    assert.ok(Math.abs(f.deltaPp ?? 0) < MIN_DELTA_PP);
    assert.equal(isHighlighted(f), false);
  });

  it("difference ≥5pp can be highlighted when n is enough", () => {
    const cases = [
      ...pack(16, "tp1", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
      ...pack(8, "tp1", { kind: "break-retest" }),
      ...pack(12, "sl", { kind: "break-retest" }),
    ];
    const f = detectFindings(cases).highlighted.find((x) => x.cut === "continuation")!;
    assert.ok((f.deltaPp ?? 0) >= 5);
  });
});

describe("P5.4 baselines and isolation", () => {
  it("baseline is the same asset, not mixed", () => {
    const cases = [
      ...pack(16, "tp1", { assetId: "XAUUSD", kind: "continuation" }),
      ...pack(4, "sl", { assetId: "XAUUSD", kind: "continuation" }),
      ...pack(8, "tp1", { assetId: "XAUUSD", kind: "break-retest" }),
      ...pack(12, "sl", { assetId: "XAUUSD", kind: "break-retest" }),
      ...pack(20, "sl", { assetId: "BTCUSD", kind: "continuation" }),
    ];
    const f = detectFindings(cases).highlighted.find((x) => x.assetId === "XAUUSD" && x.cut === "continuation")!;
    assert.equal(f.baselineN, 40);
    assert.equal(f.assetId, "XAUUSD");
    const btcCont = detectFindings(cases).findings.find((x) => x.assetId === "BTCUSD" && x.cut === "continuation");
    assert.ok(btcCont);
    assert.notEqual(btcCont!.baselineN, f.baselineN);
  });

  it("LONG is not mixed with SHORT", () => {
    const cases = [
      ...pack(16, "tp1", { direction: "buy", kind: "continuation" }),
      ...pack(4, "sl", { direction: "buy", kind: "continuation" }),
      ...pack(4, "tp1", { direction: "sell", kind: "continuation" }),
      ...pack(16, "sl", { direction: "sell", kind: "continuation" }),
    ];
    const long = detectFindings(cases).highlighted.find((x) => x.cut === "buy")!;
    const short = detectFindings(cases).highlighted.find((x) => x.cut === "sell")!;
    assert.equal(long.groupN, 20);
    assert.equal(short.groupN, 20);
    assert.equal(long.tone, "positive");
    assert.equal(short.tone, "negative");
  });

  it("continuation is not mixed with break-retest", () => {
    const cases = [
      ...pack(16, "tp1", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
      ...pack(4, "tp1", { kind: "break-retest" }),
      ...pack(16, "sl", { kind: "break-retest" }),
    ];
    const a = detectFindings(cases).highlighted.find((x) => x.cut === "continuation")!;
    const b = detectFindings(cases).highlighted.find((x) => x.cut === "break-retest")!;
    assert.equal(a.groupN, 20);
    assert.equal(b.groupN, 20);
  });
});

describe("P5.4 P5.3 semantics", () => {
  it("TP2 counts as success once; EXPIRADA and PENDING stay out", () => {
    const cases = [
      ...pack(10, "tp1", { kind: "continuation" }),
      ...pack(6, "tp2", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
      ...pack(20, "expired", { kind: "break-retest" }),
      lc({
        episodeId: "pend",
        kind: "continuation",
        outcome: "pending",
        trainable: false,
        exclusionReason: "OUTCOME_PENDING",
        origin: "production",
      }),
      lc({
        episodeId: "bad",
        kind: "continuation",
        outcome: "tp1",
        trainable: false,
        exclusionReason: "LEVELS_INCOHERENT",
        origin: "production",
      }),
    ];
    const f = detectFindings(cases).findings.find((x) => x.cut === "continuation")!;
    assert.equal(f.groupN, 20);
    assert.equal(f.groupRate.hits, 16);
  });

  it("Wilson intervals exist on highlighted groups", () => {
    const cases = [
      ...pack(16, "tp1", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
      ...pack(8, "tp1", { kind: "break-retest" }),
      ...pack(12, "sl", { kind: "break-retest" }),
    ];
    const f = detectFindings(cases).highlighted.find((x) => x.cut === "continuation")!;
    assert.ok(f.groupRate.wilsonLow != null && f.groupRate.wilsonHigh != null);
    assert.ok(f.baselineRate.wilsonLow != null);
  });

  it("period follows group openedAtMs", () => {
    const cases = [
      ...pack(16, "tp1", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
      ...pack(8, "tp1", { kind: "break-retest" }),
      ...pack(12, "sl", { kind: "break-retest" }),
    ];
    const f = detectFindings(cases).highlighted.find((x) => x.cut === "continuation")!;
    assert.ok(f.periodFromMs && f.periodToMs && f.periodToMs >= f.periodFromMs);
  });

  it("negative patterns appear", () => {
    const cases = [
      ...pack(4, "tp1", { kind: "break-retest" }),
      ...pack(16, "sl", { kind: "break-retest" }),
      ...pack(16, "tp1", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
    ];
    const f = detectFindings(cases).highlighted.find((x) => x.cut === "break-retest")!;
    assert.equal(f.tone, "negative");
    assert.ok((f.deltaPp ?? 0) <= -5);
  });
});

describe("P5.4 isolation of tests vs production", () => {
  it("fixtures origin=test do not enter production findings", () => {
    const prod = [
      ...pack(16, "tp1", { kind: "continuation", origin: "production" }),
      ...pack(4, "sl", { kind: "continuation", origin: "production" }),
      ...pack(8, "tp1", { kind: "break-retest", origin: "production" }),
      ...pack(12, "sl", { kind: "break-retest", origin: "production" }),
    ];
    const fake = pack(80, "tp1", { assetId: "WTI" as AssetId, kind: "continuation", origin: "test" });
    const report = detectFindings([...prod, ...fake]);
    assert.equal(productionCases(fake).length, 0);
    assert.equal(report.highlighted.some((f) => f.assetId === "WTI"), false);
    const all = detectFindings([...prod, ...fake], { dataset: "all" });
    assert.ok(all.findings.some((f) => f.assetId === "WTI"));
  });

  it("findings never claim to change V1", () => {
    const cases = [
      ...pack(16, "tp1", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
      ...pack(8, "tp1", { kind: "break-retest" }),
      ...pack(12, "sl", { kind: "break-retest" }),
    ];
    for (const f of detectFindings(cases).findings) {
      assert.match(f.notice, /No modifica V1/);
    }
  });

  it("is reproducible", () => {
    const cases = [
      ...pack(16, "tp1", { kind: "continuation" }),
      ...pack(4, "sl", { kind: "continuation" }),
      ...pack(8, "tp1", { kind: "break-retest" }),
      ...pack(12, "sl", { kind: "break-retest" }),
    ];
    assert.deepEqual(detectFindings(cases), detectFindings(cases));
  });
});
