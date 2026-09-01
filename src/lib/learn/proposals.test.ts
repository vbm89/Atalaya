import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { AssetId } from "../trading/types.ts";
import type { LearningCase } from "./case.ts";
import { detectFindings } from "./patterns.ts";
import {
  actionableProposals,
  applyProposalToEngine,
  applyProposalToSignals,
  P5_PROPOSAL_IS_NOT_A_V1_RULE,
  proposalFromFinding,
  proposalsFromCases,
  PROPOSAL_NOTICE,
} from "./proposals.ts";

function lc(partial: Partial<LearningCase> = {}): LearningCase {
  return {
    episodeId: "e",
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
  outcome: "tp1" | "sl",
  extra: Partial<LearningCase>,
): LearningCase[] {
  return Array.from({ length: n }, (_, i) =>
    lc({
      episodeId: `${extra.kind}-${outcome}-${extra.origin ?? "p"}-${i}`,
      outcome,
      firstTouch: outcome,
      openedAtMs: Date.parse("2026-03-01T08:00:00Z") + i * 86_400_000,
      ...extra,
    }),
  );
}

const mixed = [
  ...pack(16, "tp1", { kind: "continuation" }),
  ...pack(4, "sl", { kind: "continuation" }),
  ...pack(8, "tp1", { kind: "break-retest" }),
  ...pack(12, "sl", { kind: "break-retest" }),
];

describe("P5.5 hypotheses", () => {
  it("negative finding generates a hypothesis", () => {
    const f = detectFindings(mixed).highlighted.find((x) => x.cut === "break-retest")!;
    const p = proposalFromFinding(f, 1);
    assert.equal(p.tone, "negative");
    assert.match(p.hypothesis, /asociada históricamente/);
    assert.match(p.hypothesis, /No se afirma causalidad/);
    assert.equal(p.kindLabel, "proposal_to_validate");
    assert.match(p.proposedChange, /condición adicional/);
    assert.doesNotMatch(p.proposedChange, /R:R mínimo/);
  });

  it("positive finding generates a hypothesis without pickBest", () => {
    const f = detectFindings(mixed).highlighted.find((x) => x.cut === "continuation")!;
    const p = proposalFromFinding(f, 1);
    assert.equal(p.tone, "positive");
    assert.match(p.hypothesis, /mejor resultado/);
    assert.match(p.proposedChange, /factor de confianza/);
    assert.match(p.proposedChange, /No se altera pickBest/);
  });

  it("insufficient evidence is not actionable", () => {
    const small = [...pack(6, "tp1", { kind: "continuation" }), ...pack(6, "sl", { kind: "break-retest" })];
    const f = detectFindings(small).findings.find((x) => x.cut === "continuation")!;
    const p = proposalFromFinding(f, 1);
    assert.equal(p.kindLabel, "not_actionable");
    assert.match(p.proposedChange, /no accionable/i);
    assert.equal(actionableProposals([p]).length, 0);
  });
});

describe("P5.5 proposal contract", () => {
  it("always born proposed, never approved or applied", () => {
    const list = proposalsFromCases(mixed, 99);
    assert.ok(list.length > 0);
    for (const p of list) {
      assert.equal(p.status, "proposed");
      assert.equal("approved" in p ? (p as { approved?: unknown }).approved : undefined, undefined);
    }
    const action = actionableProposals(list);
    assert.ok(action.length >= 1);
    assert.ok(action.every((p) => p.status === "proposed"));
    assert.ok(action.every((p) => p.testN === 0));
    assert.match(action[0]!.needsOutOfSample, /fuera de muestra/);
  });

  it("shows evidence, baseline and n", () => {
    const f = detectFindings(mixed).highlighted.find((x) => x.cut === "continuation")!;
    const p = proposalFromFinding(f, 1);
    assert.equal(p.trainN, f.groupN);
    assert.equal(p.observedRate.n, f.groupRate.n);
    assert.equal(p.baselineRate.n, f.baselineN);
    assert.equal(p.deltaPp, f.deltaPp);
    assert.equal(p.notice, PROPOSAL_NOTICE);
  });

  it("does not invent unknown dimensions", () => {
    const fake = detectFindings(mixed).highlighted[0]!;
    const p = proposalFromFinding({ ...fake, dim: "unicorn", cut: "magic" }, 1);
    assert.equal(p.kindLabel, "not_actionable");
  });

  it("does not mutate learning cases", () => {
    const copy = JSON.stringify(mixed);
    proposalsFromCases(mixed, 1);
    assert.equal(JSON.stringify(mixed), copy);
  });

  it("test fixtures do not create production proposals", () => {
    const fake = [
      ...pack(16, "tp1", { assetId: "WTI" as AssetId, kind: "continuation", origin: "test" }),
      ...pack(4, "sl", { assetId: "WTI" as AssetId, kind: "continuation", origin: "test" }),
      ...pack(8, "tp1", { assetId: "WTI" as AssetId, kind: "break-retest", origin: "test" }),
      ...pack(12, "sl", { assetId: "WTI" as AssetId, kind: "break-retest", origin: "test" }),
    ];
    const prod = proposalsFromCases([...mixed, ...fake], 1);
    assert.equal(prod.some((p) => p.asset === "WTI"), false);
    const all = proposalsFromCases([...mixed, ...fake], 1, { dataset: "all" });
    assert.ok(all.some((p) => p.asset === "WTI"));
  });

  it("cannot execute against engine or signals", () => {
    const p = proposalFromFinding(detectFindings(mixed).highlighted[0]!, 1);
    assert.equal(P5_PROPOSAL_IS_NOT_A_V1_RULE, true);
    assert.throws(() => applyProposalToEngine(p), /no hay ruta hacia el motor/i);
    assert.throws(() => applyProposalToSignals(p), /señales ni filtros/i);
    const src = readFileSync(new URL("./proposals.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /from ["'].*trading\/engine/);
    assert.doesNotMatch(src, /from ["'].*trading\/signals/);
    assert.doesNotMatch(src, /pickBest\(/);
  });
});
