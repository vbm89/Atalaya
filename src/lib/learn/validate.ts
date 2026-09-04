import type { LearningCase } from "./case";
import { v1TradeCases } from "./case";
import {
  assetUniverse,
  detectFindings,
  filterByCut,
  productionCases,
} from "./patterns";
import {
  P5_PROPOSAL_IS_NOT_A_V1_RULE,
  actionableProposals,
  applyProposalToEngine,
  proposalsFromFindings,
  type Proposal,
} from "./proposals";
import { formatMadridDate, summarize, type Rate } from "./stats";

export const VALIDATION_ALGO = "p56-v1-7030";
export const TRAIN_RATIO = 0.7;
export const MIN_TEST_N = 30;
export const MIN_DELTA_PP = 5;

export type ValidationVerdict = "PENDING_VALIDATION" | "VALIDATED" | "REJECTED" | "INCONCLUSIVE";

export interface TemporalSplit {
  train: LearningCase[];
  test: LearningCase[];
  splitAtMs: number | null;
  trainRatio: number;
}

export interface SliceScore {
  n: number;
  hypothesis: Rate;
  baseline: Rate;
  deltaPp: number | null;
  periodFromMs: number | null;
  periodToMs: number | null;
}

export interface ValidationRecord {
  validationId: string;
  proposalId: string;
  algo: typeof VALIDATION_ALGO;
  createdAtMs: number;
  asset: Proposal["asset"];
  dim: string;
  cut: string;
  tone: Proposal["tone"];
  hypothesis: string;
  train: SliceScore;
  test: SliceScore;
  verdict: ValidationVerdict;
  reason: string;
  notice: string;
  trainBeforeTest: boolean;
}

export interface ValidationReport {
  split: TemporalSplit;
  records: ValidationRecord[];
  tried: number;
  validated: number;
  rejected: number;
  inconclusive: number;
  notice: string;
}

export const VALIDATION_NOTICE =
  "VALIDATED no significa apta para trading ni cambio en V1. Requiere revisión humana.";

export function splitTemporal(cases: LearningCase[], ratio = TRAIN_RATIO): TemporalSplit {
  const sorted = [...cases].sort((a, b) => {
    if (a.openedAtMs !== b.openedAtMs) return a.openedAtMs - b.openedAtMs;
    return a.episodeId.localeCompare(b.episodeId);
  });
  if (sorted.length < 2) {
    return { train: sorted, test: [], splitAtMs: sorted[0]?.openedAtMs ?? null, trainRatio: 1 };
  }
  const idx = Math.max(1, Math.min(sorted.length - 1, Math.floor(sorted.length * ratio)));
  const train2 = sorted.slice(0, idx);
  const test2 = sorted.slice(idx);
  return {
    train: train2,
    test: test2,
    splitAtMs: train2[train2.length - 1]?.openedAtMs ?? null,
    trainRatio: sorted.length ? train2.length / sorted.length : 0,
  };
}

/** Future walk-forward: first fold is the 70/30 split. Extra folds not run in P5.6. */
export function plannedWalkForward(cases: LearningCase[]): { folds: TemporalSplit[]; note: string } {
  return {
    folds: [splitTemporal(cases)],
    note: "P5.6 usa un único corte 70/30. Walk-forward multi-fold queda preparado, no ejecutado.",
  };
}

function scoreSlice(universe: LearningCase[], dim: string, cut: string): SliceScore {
  const group = filterByCut(universe, dim, cut);
  const g = summarize(group).global;
  const b = summarize(universe).global;
  const deltaPp =
    g.success.pct != null && b.success.pct != null ? (g.success.pct - b.success.pct) * 100 : null;
  return {
    n: g.success.n,
    hypothesis: g.success,
    baseline: b.success,
    deltaPp,
    periodFromMs: g.periodFromMs,
    periodToMs: g.periodToMs,
  };
}

function aligned(tone: Proposal["tone"], delta: number | null): boolean {
  if (delta == null) return false;
  return tone === "positive" ? delta >= MIN_DELTA_PP : delta <= -MIN_DELTA_PP;
}

function against(tone: Proposal["tone"], delta: number | null): boolean {
  if (delta == null) return false;
  return tone === "positive" ? delta < 0 : delta > 0;
}

export function judge(train: SliceScore, test: SliceScore, tone: Proposal["tone"], trainBeforeTest: boolean): {
  verdict: ValidationVerdict;
  reason: string;
} {
  if (!trainBeforeTest) {
    return { verdict: "INCONCLUSIVE", reason: "El train no es estrictamente anterior al test." };
  }
  if (test.n < MIN_TEST_N) {
    return {
      verdict: "INCONCLUSIVE",
      reason: `TEST n=${test.n} < ${MIN_TEST_N}. Todavía no hay suficiente muestra fuera de muestra.`,
    };
  }
  if (train.deltaPp == null || test.deltaPp == null) {
    return { verdict: "INCONCLUSIVE", reason: "No hay tasa comparable (EXPIRADA/PENDING no cuentan como éxito)." };
  }
  if (against(tone, test.deltaPp)) {
    return {
      verdict: "REJECTED",
      reason: "La mejora observada en entrenamiento no se reprodujo en datos posteriores (sobreajuste o signo invertido).",
    };
  }
  if (aligned(tone, train.deltaPp) && aligned(tone, test.deltaPp)) {
    return {
      verdict: "VALIDATED",
      reason: "Esta hipótesis mostró una mejora consistente fuera de muestra bajo las condiciones de esta validación.",
    };
  }
  if (Math.abs(test.deltaPp) < MIN_DELTA_PP) {
    return {
      verdict: "INCONCLUSIVE",
      reason: "Diferencia en TEST < 5 pp. No validada.",
    };
  }
  return { verdict: "INCONCLUSIVE", reason: "Evidencia fuera de muestra insuficiente para concluir." };
}

export function validateProposal(
  proposal: Proposal,
  train: LearningCase[],
  test: LearningCase[],
  createdAtMs: number,
): ValidationRecord {
  const trainUni = assetUniverse(train, proposal.asset);
  const testUni = assetUniverse(test, proposal.asset);
  const trainScore = scoreSlice(trainUni, proposal.dim, proposal.cut);
  const testScore = scoreSlice(testUni, proposal.dim, proposal.cut);
  const lastTrain = train.reduce((m, c) => Math.max(m, c.openedAtMs), 0);
  const firstTest = test.reduce((m, c) => Math.min(m, c.openedAtMs), Number.POSITIVE_INFINITY);
  const trainBeforeTest = test.length === 0 ? false : lastTrain <= firstTest;
  const judged = judge(trainScore, testScore, proposal.tone, trainBeforeTest);
  return {
    validationId: `v:${proposal.proposalId}`,
    proposalId: proposal.proposalId,
    algo: VALIDATION_ALGO,
    createdAtMs,
    asset: proposal.asset,
    dim: proposal.dim,
    cut: proposal.cut,
    tone: proposal.tone,
    hypothesis: proposal.hypothesis,
    train: trainScore,
    test: testScore,
    verdict: judged.verdict,
    reason: judged.reason,
    notice: "Esto no modifica V1. VALIDATED ≠ APPROVED ≠ APPLIED.",
    trainBeforeTest,
  };
}

export function runValidation(
  cases: LearningCase[],
  createdAtMs: number,
  opts?: { dataset?: "production" | "all" },
): ValidationReport {
  const src = v1TradeCases(opts?.dataset === "all" ? cases : productionCases(cases));
  const split = splitTemporal(src);
  const discovered = actionableProposals(
    proposalsFromFindings(detectFindings(split.train, { dataset: "all" }).findings, createdAtMs),
  );
  const records = discovered.map((p) => validateProposal(p, split.train, split.test, createdAtMs));
  return {
    split,
    records,
    tried: records.length,
    validated: records.filter((r) => r.verdict === "VALIDATED").length,
    rejected: records.filter((r) => r.verdict === "REJECTED").length,
    inconclusive: records.filter((r) => r.verdict === "INCONCLUSIVE").length,
    notice: VALIDATION_NOTICE,
  };
}

export function applyValidationToEngine(_record: ValidationRecord): never {
  throw new Error("P5 validation ≠ V1 rule. VALIDATED ≠ APPROVED. No hay ruta hacia el motor.");
}

export { P5_PROPOSAL_IS_NOT_A_V1_RULE, applyProposalToEngine, formatMadridDate };
