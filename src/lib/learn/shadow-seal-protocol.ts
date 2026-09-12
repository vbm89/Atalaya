/**
 * SEAL protocol for Shadow hypotheses.
 *
 * Written before TEST is inspected. Opening TEST is one-way (REGISTERED → SEALED)
 * and only after these TRAIN + calendar gates pass. TEST outcomes, TEST
 * expectancy and TEST success are not inputs and must not be consulted.
 *
 * Promotion (live / V1) is a different gate. Sealing only reveals TEST.
 */
import { concentrationVeto, type ConcentrationRow } from "./shadow-concentration";

export const SHADOW_SEAL_PROTOCOL = Object.freeze({
  /** A priori floor — not fitted to current K1 counts. */
  minTrainDecided: 80,
  minObservationDaysAfterRegistration: 90,
  minTrainAssetsWithDecided: 2,
  minTrainDecidedPerStabilityHalf: 20,
  maxTrainPendingRatio: 0.5,
  requireCostsKnown: true,
  requireConcentrationStable: true,
  requireTrainSplitSameSign: true,
  oneWay: true,
  inspectsTestOutcomes: false as const,
  inspectsTestExpectancy: false as const,
  inspectsTestSuccess: false as const,
});

export interface SealTrainTrade {
  assetId: string;
  decisionSlot: number;
  outcome: "tp1" | "tp2" | "sl" | "pending" | string;
  rrAtOutcome: number | null;
}

export interface SealReadinessInput {
  hypothesisId: string;
  status: "REGISTERED" | "SEALED" | "LEGACY_NOT_PREREGISTERED";
  registeredAtSec: number;
  nowSec: number;
  trainDecided: number;
  trainPending: number;
  trainTrades: readonly SealTrainTrade[];
  costsKnown: boolean;
  assetsWithTrainDecided: number;
}

export interface SealGate {
  id: string;
  passed: boolean;
  detail: string;
}

export interface SealReadiness {
  eligible: boolean;
  canRevealTest: boolean;
  status: "NOT_READY" | "READY_TO_SEAL" | "SEALED";
  reasons: string[];
  gates: SealGate[];
  observationDays: number;
  trainDecided: number;
  inspectsTestOutcomes: false;
}

function sign(v: number | null): -1 | 0 | 1 | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v > 0) return 1;
  if (v < 0) return -1;
  return 0;
}

function trainSplitSameSign(trades: readonly SealTrainTrade[]): { passed: boolean; detail: string } {
  const decided = trades
    .filter((t) => t.outcome === "tp1" || t.outcome === "tp2" || t.outcome === "sl")
    .slice()
    .sort((a, b) => a.decisionSlot - b.decisionSlot);
  const half = SHADOW_SEAL_PROTOCOL.minTrainDecidedPerStabilityHalf;
  if (decided.length < half * 2) {
    return { passed: false, detail: `TRAIN split: ${decided.length} decididos, hacen falta ${half * 2}` };
  }
  const mid = Math.floor(decided.length / 2);
  const mean = (rows: SealTrainTrade[]): number | null => {
    const rs = rows.map((r) => r.rrAtOutcome).filter((v): v is number => v != null && Number.isFinite(v));
    return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  };
  const a = mean(decided.slice(0, mid));
  const b = mean(decided.slice(mid));
  const sa = sign(a);
  const sb = sign(b);
  if (sa == null || sb == null) return { passed: false, detail: "TRAIN split: R no medible en un tramo" };
  if (sa !== sb) return { passed: false, detail: "TRAIN split: los dos tramos cronológicos no comparten signo" };
  return { passed: true, detail: "TRAIN split: mismo signo en ambos tramos" };
}

function pendingRatio(decided: number, pending: number): number {
  const den = decided + pending;
  return den === 0 ? 1 : pending / den;
}

/**
 * Fail-closed. Never reads TEST. Extra fields on the input object are ignored.
 */
export function evaluateSealReadiness(input: SealReadinessInput): SealReadiness {
  const observationDays = Math.max(0, Math.floor((input.nowSec - input.registeredAtSec) / 86400));
  const gates: SealGate[] = [];
  const reasons: string[] = [];

  if (input.status === "SEALED") {
    return {
      eligible: true,
      canRevealTest: true,
      status: "SEALED",
      reasons: [],
      gates: [{ id: "already_sealed", passed: true, detail: "SEALED: TEST ya revelado, no se vuelve a REGISTERED" }],
      observationDays,
      trainDecided: input.trainDecided,
      inspectsTestOutcomes: false,
    };
  }

  const push = (id: string, passed: boolean, detail: string, reason?: string) => {
    gates.push({ id, passed, detail });
    if (!passed && reason) reasons.push(reason);
  };

  push(
    "train_decided",
    input.trainDecided >= SHADOW_SEAL_PROTOCOL.minTrainDecided,
    `TRAIN decididos ${input.trainDecided}/${SHADOW_SEAL_PROTOCOL.minTrainDecided}`,
    `TRAIN decididos < ${SHADOW_SEAL_PROTOCOL.minTrainDecided}`,
  );
  push(
    "observation_days",
    observationDays >= SHADOW_SEAL_PROTOCOL.minObservationDaysAfterRegistration,
    `observación ${observationDays}/${SHADOW_SEAL_PROTOCOL.minObservationDaysAfterRegistration} días desde registeredAt`,
    `observación < ${SHADOW_SEAL_PROTOCOL.minObservationDaysAfterRegistration} días`,
  );
  push(
    "train_assets",
    input.assetsWithTrainDecided >= SHADOW_SEAL_PROTOCOL.minTrainAssetsWithDecided,
    `activos TRAIN decididos ${input.assetsWithTrainDecided}/${SHADOW_SEAL_PROTOCOL.minTrainAssetsWithDecided}`,
    `TRAIN en menos de ${SHADOW_SEAL_PROTOCOL.minTrainAssetsWithDecided} activos`,
  );
  const ratio = pendingRatio(input.trainDecided, input.trainPending);
  push(
    "tape_quality",
    ratio <= SHADOW_SEAL_PROTOCOL.maxTrainPendingRatio,
    `pending TRAIN ratio ${ratio.toFixed(2)}`,
    "calidad de cinta TRAIN: demasiado pending",
  );
  push(
    "costs",
    !SHADOW_SEAL_PROTOCOL.requireCostsKnown || input.costsKnown,
    input.costsKnown ? "costes conocidos" : "costes UNKNOWN",
    "costes desconocidos",
  );

  const concRows: ConcentrationRow[] = input.trainTrades.map((t) => ({
    decisionSlot: t.decisionSlot,
    outcome: t.outcome,
    rrAtOutcome: t.rrAtOutcome,
  }));
  const conc = concentrationVeto(concRows);
  const concOk = !SHADOW_SEAL_PROTOCOL.requireConcentrationStable || !conc.veto;
  push(
    "concentration",
    concOk,
    conc.veto ? (conc.reason ?? "concentración") : "concentración TRAIN estable",
    conc.reason ? `concentración TRAIN: ${conc.reason}` : "concentración TRAIN inestable",
  );

  const split = trainSplitSameSign(input.trainTrades);
  push("train_split", !SHADOW_SEAL_PROTOCOL.requireTrainSplitSameSign || split.passed, split.detail, split.detail);

  const eligible = reasons.length === 0 && input.status === "REGISTERED";
  return {
    eligible,
    canRevealTest: false,
    status: eligible ? "READY_TO_SEAL" : "NOT_READY",
    reasons,
    gates,
    observationDays,
    trainDecided: input.trainDecided,
    inspectsTestOutcomes: false,
  };
}

/** One-way. Never unseals. Never looks at TEST. */
export function nextHypothesisStatus(
  current: SealReadinessInput["status"],
  readiness: SealReadiness,
): SealReadinessInput["status"] {
  if (current === "SEALED") return "SEALED";
  if (current === "REGISTERED" && readiness.eligible) return "SEALED";
  return current;
}
