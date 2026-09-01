import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LearningCase } from "./case.ts";
import {
  EVIDENCE_GATES,
  LEARN_HISTORY_WINDOW,
  buildEvolution,
  evidenceGate,
  phaseOf,
} from "./evolution.ts";
import { detectFindings } from "./patterns.ts";
import { applyProposalToEngine } from "./proposals.ts";
import { evidenceLevel } from "./stats.ts";
import { runValidation, type ValidationReport } from "./validate.ts";

function lc(partial: Partial<LearningCase> = {}): LearningCase {
  return {
    episodeId: partial.episodeId ?? "e",
    assetId: "XAUUSD",
    direction: "buy",
    kind: "continuation",
    timeframe: "15m",
    openedAtMs: Date.parse("2026-09-01T08:00:00Z"),
    closedAtMs: Date.parse("2026-09-01T10:00:00Z"),
    openedState: "map",
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
    firstTouchAtMs: Date.parse("2026-09-01T09:00:00Z"),
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

function emptyValidation(): ValidationReport {
  return {
    split: { train: [], test: [], splitAtMs: null, trainRatio: 1 },
    records: [],
    tried: 0,
    validated: 0,
    rejected: 0,
    inconclusive: 0,
    notice: "",
  };
}

describe("learning evolution", () => {
  it("P5 evidenceLevel still owns 20/50/80; the panel does not invent gates", () => {
    assert.deepEqual([...EVIDENCE_GATES], [20, 50, 80]);
    assert.equal(evidenceLevel(19), "insufficient");
    assert.equal(evidenceLevel(20), "observation");
    assert.equal(evidenceLevel(49), "observation");
    assert.equal(evidenceLevel(50), "potential_pattern");
    assert.equal(evidenceLevel(79), "potential_pattern");
    assert.equal(evidenceLevel(80), "stronger");
  });

  it("empty history is SIN MUESTRA and does not invent a 100% bar", () => {
    const evo = buildEvolution([], detectFindings([]), emptyValidation());
    assert.equal(evo.phase.id, "sin_muestra");
    assert.equal(evo.observed, 0);
    assert.equal(evo.trainable, 0);
    assert.equal(evo.detected, 0);
    assert.equal(evo.validated, 0);
    assert.equal(evo.gate.target, 20);
    assert.equal(evo.gate.current, 0);
    assert.equal(evo.gate.reached, false);
  });

  it("few decided cases is RECOPILANDO toward n=20", () => {
    const cases = Array.from({ length: 6 }, (_, i) =>
      lc({ episodeId: `e${i}`, outcome: i % 2 ? "sl" : "tp1" }),
    );
    const evo = buildEvolution(cases, detectFindings(cases), runValidation(cases, 0));
    assert.equal(evo.phase.id, "recopilando");
    assert.equal(evo.decided, 6);
    assert.equal(evo.gate.target, 20);
    assert.equal(evo.gate.current, 6);
  });

  it("maps evidenceLevel onto OBSERVACIÓN / PATRÓN POTENCIAL / EVIDENCIA MÁS SÓLIDA", () => {
    assert.equal(phaseOf(20).id, "observacion");
    assert.equal(phaseOf(50).id, "patron_potencial");
    assert.equal(phaseOf(80).id, "evidencia_solida");
    assert.equal(phaseOf(20).label, "OBSERVACIÓN");
    assert.equal(phaseOf(50).label, "PATRÓN POTENCIAL");
    assert.equal(phaseOf(80).label, "EVIDENCIA MÁS SÓLIDA");
  });

  it("excluded pending cases are not trainable and do not fill the evidence bar", () => {
    const cases = [
      lc({ episodeId: "ok", outcome: "tp1", trainable: true }),
      lc({
        episodeId: "pend",
        outcome: "pending",
        trainable: false,
        exclusionReason: "OUTCOME_PENDING",
      }),
    ];
    const evo = buildEvolution(cases, detectFindings(cases), emptyValidation());
    assert.equal(evo.observed, 2);
    assert.equal(evo.trainable, 1);
    assert.equal(evo.excluded, 1);
    assert.equal(evo.decided, 1);
    assert.equal(evo.gate.current, 1);
  });

  it("validated count is reported separately and does not create APRENDIZAJE OPERATIVO", () => {
    const cases = Array.from({ length: 24 }, (_, i) => lc({ episodeId: `v${i}`, outcome: "tp1" }));
    const injected: ValidationReport = { ...emptyValidation(), validated: 2, tried: 2 };
    const evo = buildEvolution(cases, detectFindings(cases), injected);
    assert.equal(evo.validated, 2);
    assert.equal(evo.phase.id, "observacion");
    assert.doesNotMatch(JSON.stringify(evo), /APRENDIZAJE OPERATIVO/);
  });

  it("per-asset rows exist even with zero cases", () => {
    const evo = buildEvolution([], detectFindings([]), emptyValidation());
    assert.deepEqual(
      evo.byAsset.map((a) => a.assetId),
      ["XAUUSD", "BTCUSD", "US100", "WTI"],
    );
    for (const a of evo.byAsset) {
      assert.equal(a.observed, 0);
      assert.equal(a.phase.id, "sin_muestra");
    }
  });

  it("series accumulates trainable by Madrid day", () => {
    const cases = [
      lc({ episodeId: "a", openedAtMs: Date.parse("2026-08-01T10:00:00Z"), trainable: true, outcome: "tp1" }),
      lc({
        episodeId: "b",
        openedAtMs: Date.parse("2026-08-02T10:00:00Z"),
        trainable: false,
        exclusionReason: "OUTCOME_PENDING",
        outcome: "pending",
      }),
    ];
    const evo = buildEvolution(cases, detectFindings(cases), emptyValidation());
    assert.equal(evo.series.length, 2);
    assert.equal(evo.series[0]?.trainable, 1);
    assert.equal(evo.series[1]?.observed, 2);
    assert.equal(evo.series[1]?.trainable, 1);
  });

  it("evidence gates follow 20 / 50 / 80", () => {
    assert.equal(evidenceGate(0).target, 20);
    assert.equal(evidenceGate(19).target, 20);
    assert.equal(evidenceGate(20).target, 50);
    assert.equal(evidenceGate(50).target, 80);
    assert.equal(evidenceGate(80).reached, true);
    assert.equal(evidenceGate(80).target, 80);
  });

  it("history window is the fetch cap, not a goal of 100", () => {
    assert.equal(LEARN_HISTORY_WINDOW, 80);
  });

  it("applyProposalToEngine stays blocked", () => {
    assert.throws(
      () => applyProposalToEngine({} as never),
      /P5 proposal ≠ V1 rule/,
    );
  });
});
