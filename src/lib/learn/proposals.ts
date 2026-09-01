import type { AssetId } from "../trading/types";
import type { LearningCase } from "./case";
import {
  detectFindings,
  isHighlighted,
  type Finding,
  type FindingTone,
} from "./patterns";
import type { EvidenceLevel, Rate } from "./stats";

/**
 * P5 proposal ≠ V1 rule.
 * A proposal is a research object. It never becomes a trading rule here.
 * There is no path: proposal → engine / filter / signal.
 */
export const P5_PROPOSAL_IS_NOT_A_V1_RULE = true as const;

export type ProposalStatus = "proposed";
export type ProposalKind = "observation" | "hypothesis" | "proposal_to_validate" | "not_actionable";

const KNOWN_DIMS = new Set(["direction", "kind", "quality", "rr", "impact", "session"]);

export interface Proposal {
  proposalId: string;
  createdAtMs: number;
  sourceFindingId: string;
  asset: AssetId | "GLOBAL";
  direction: "buy" | "sell" | null;
  kind: string | null;
  dim: string;
  cut: string;
  tone: FindingTone;
  hypothesis: string;
  proposedChange: string;
  reason: string;
  evidence: EvidenceLevel;
  trainN: number;
  testN: number;
  baselineRate: Rate;
  observedRate: Rate;
  deltaPp: number | null;
  status: ProposalStatus;
  kindLabel: ProposalKind;
  needsOutOfSample: string;
  notice: string;
}

export const PROPOSAL_NOTICE = "Esta propuesta no modifica V1.";
export const PENDING_VALIDATION = "Pendiente de validación fuera de muestra.";

function dimKnown(dim: string): boolean {
  return KNOWN_DIMS.has(dim);
}

function hypothesisOf(f: Finding): string {
  const assoc =
    f.tone === "negative"
      ? "está asociada históricamente con peor resultado"
      : "está asociada históricamente con mejor resultado";
  return `En el histórico de Atalaya, ${f.label} ${assoc}. No se afirma causalidad.`;
}

function proposedChangeOf(f: Finding): { text: string; kindLabel: ProposalKind } {
  if (f.evidence === "insufficient" || !isHighlighted(f)) {
    return {
      text: "Hipótesis no accionable con los datos actuales.",
      kindLabel: "not_actionable",
    };
  }
  if (!dimKnown(f.dim)) {
    return {
      text: "Hipótesis no accionable con los datos actuales.",
      kindLabel: "not_actionable",
    };
  }
  if (f.tone === "negative") {
    return {
      text: `Investigar si una condición adicional sobre ${f.dim}=${f.cut} discrimina este grupo antes de ENTRY. No se propone un umbral nuevo ni un filtro automático.`,
      kindLabel: "proposal_to_validate",
    };
  }
  return {
    text: `Investigar si ${f.dim}=${f.cut} puede usarse como factor de confianza descriptivo. No se altera pickBest, ranking ni V1.`,
    kindLabel: "proposal_to_validate",
  };
}

export function proposalFromFinding(f: Finding, createdAtMs: number): Proposal {
  const change = proposedChangeOf(f);
  return {
    proposalId: `p:${f.id}`,
    createdAtMs,
    sourceFindingId: f.id,
    asset: f.assetId,
    direction: f.dim === "direction" && (f.cut === "buy" || f.cut === "sell") ? f.cut : null,
    kind: f.dim === "kind" ? f.cut : null,
    dim: f.dim,
    cut: f.cut,
    tone: f.tone,
    hypothesis: hypothesisOf(f),
    proposedChange: change.text,
    reason: f.text,
    evidence: f.evidence,
    trainN: f.groupN,
    testN: 0,
    baselineRate: f.baselineRate,
    observedRate: f.groupRate,
    deltaPp: f.deltaPp,
    status: "proposed",
    kindLabel: change.kindLabel,
    needsOutOfSample: PENDING_VALIDATION,
    notice: PROPOSAL_NOTICE,
  };
}

export function proposalsFromFindings(findings: Finding[], createdAtMs: number): Proposal[] {
  return findings.map((f) => proposalFromFinding(f, createdAtMs));
}

export function actionableProposals(proposals: Proposal[]): Proposal[] {
  return proposals.filter((p) => p.kindLabel === "proposal_to_validate" && p.status === "proposed");
}

export function proposalsFromCases(
  cases: LearningCase[],
  createdAtMs: number,
  opts?: { dataset?: "production" | "all" },
): Proposal[] {
  const report = detectFindings(cases, opts);
  return proposalsFromFindings(report.findings, createdAtMs);
}

/** Hard barrier: a proposal cannot be executed against the engine. */
export function applyProposalToEngine(_proposal: Proposal): never {
  throw new Error("P5 proposal ≠ V1 rule. No hay ruta hacia el motor.");
}

export function applyProposalToSignals(_proposal: Proposal): never {
  throw new Error("P5 proposal ≠ V1 rule. No hay ruta hacia señales ni filtros.");
}
