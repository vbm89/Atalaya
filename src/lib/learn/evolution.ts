import type { AssetId } from "../trading/types";
import type { LearningCase } from "./case";
import { v1TradeCases } from "./case";
import { detectFindings, productionCases, type PatternReport } from "./patterns";
import {
  evidenceLevel,
  formatMadridDate,
  summarize,
  type BucketStats,
  type EvidenceLevel,
} from "./stats";
import { MIN_TEST_N, runValidation, splitTemporal, type ValidationReport } from "./validate";

/** Matches getWatchHistory() window. Not a learning target. */
export const LEARN_HISTORY_WINDOW = 80;

/**
 * Existing P5 evidence gates (evidenceLevel in stats.ts). Duplicated here so
 * this panel does not edit P5. Tests assert they stay aligned.
 */
export const EVIDENCE_GATES = [20, 50, 80] as const;

export type EvolutionPhaseId =
  | "sin_muestra"
  | "recopilando"
  | "observacion"
  | "patron_potencial"
  | "evidencia_solida";

export interface EvolutionPhase {
  id: EvolutionPhaseId;
  label: string;
  hint: string;
  evidence: EvidenceLevel;
}

export interface EvidenceGate {
  current: number;
  target: number;
  label: string;
  reached: boolean;
}

export interface EvolutionDay {
  day: string;
  label: string;
  openedAtMs: number;
  observed: number;
  trainable: number;
  detected: number;
  validated: number;
}

export interface AssetEvolution {
  assetId: AssetId;
  observed: number;
  trainable: number;
  excluded: number;
  decided: number;
  detected: number;
  validated: number;
  phase: EvolutionPhase;
  gate: EvidenceGate;
}

export interface EvolutionReport {
  window: number;
  truncated: boolean;
  observed: number;
  trainable: number;
  excluded: number;
  decided: number;
  detected: number;
  validated: number;
  rejected: number;
  inconclusive: number;
  phase: EvolutionPhase;
  gate: EvidenceGate;
  byAsset: AssetEvolution[];
  series: EvolutionDay[];
  notice: string;
  barNotice: string;
}

export const EVOLUTION_NOTICE =
  "El aprendizaje es análisis histórico. No modifica las decisiones de V1.";

export const EVIDENCE_BAR_NOTICE =
  "Los umbrales 20/50/80 representan evidencia disponible, no porcentaje de inteligencia.";

const PHASES: Record<EvolutionPhaseId, EvolutionPhase> = {
  sin_muestra: {
    id: "sin_muestra",
    label: "SIN MUESTRA",
    hint: "No hay casos decididos (TP1, TP2 o SL) en la ventana de historial.",
    evidence: "insufficient",
  },
  recopilando: {
    id: "recopilando",
    label: "RECOPILANDO",
    hint: "Hay histórico, pero la muestra decidida es menor que 20 (umbral interno de observación).",
    evidence: "insufficient",
  },
  observacion: {
    id: "observacion",
    label: "OBSERVACIÓN",
    hint: "Muestra limitada. n ≥ 20 casos decididos (TP1+TP2+SL).",
    evidence: "observation",
  },
  patron_potencial: {
    id: "patron_potencial",
    label: "PATRÓN POTENCIAL",
    hint: "n ≥ 50 casos decididos. No validado. No cambia V1.",
    evidence: "potential_pattern",
  },
  evidencia_solida: {
    id: "evidencia_solida",
    label: "EVIDENCIA MÁS SÓLIDA",
    hint: "n ≥ 80 casos decididos. No implica cambiar V1.",
    evidence: "stronger",
  },
};

export function phaseOf(decided: number): EvolutionPhase {
  if (!Number.isFinite(decided) || decided <= 0) return PHASES.sin_muestra;
  const ev = evidenceLevel(decided);
  if (ev === "insufficient") return PHASES.recopilando;
  if (ev === "observation") return PHASES.observacion;
  if (ev === "potential_pattern") return PHASES.patron_potencial;
  return PHASES.evidencia_solida;
}

export function evidenceGate(decided: number): EvidenceGate {
  const n = Number.isFinite(decided) && decided > 0 ? decided : 0;
  const [g20, g50, g80] = EVIDENCE_GATES;
  if (n < g20) {
    return {
      current: n,
      target: g20,
      label: `Hacia observación (${g20} casos decididos)`,
      reached: false,
    };
  }
  if (n < g50) {
    return {
      current: n,
      target: g50,
      label: `Hacia patrón potencial (${g50} casos decididos)`,
      reached: false,
    };
  }
  if (n < g80) {
    return {
      current: n,
      target: g80,
      label: `Hacia evidencia más sólida (${g80} casos decididos)`,
      reached: false,
    };
  }
  return {
    current: n,
    target: g80,
    label: `Umbral de evidencia más sólida alcanzado (${g80})`,
    reached: true,
  };
}

function madridDayKey(ms: number): { key: string; label: string; openedAtMs: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const d = parts.find((p) => p.type === "day")?.value ?? "00";
  const key = `${y}-${m}-${d}`;
  return { key, label: formatMadridDate(ms), openedAtMs: ms };
}

function detectedFor(report: PatternReport, assetId: AssetId | "GLOBAL"): number {
  if (assetId === "GLOBAL") return report.highlighted.length;
  return report.highlighted.filter((f) => f.assetId === assetId).length;
}

function validatedFor(report: ValidationReport, assetId: AssetId | "GLOBAL"): number {
  const rows = report.records.filter((r) => r.verdict === "VALIDATED");
  if (assetId === "GLOBAL") return rows.length;
  return rows.filter((r) => r.asset === assetId).length;
}

function assetSlice(
  bucket: BucketStats,
  patterns: PatternReport,
  validation: ValidationReport,
): AssetEvolution {
  const assetId = bucket.key as AssetId;
  const decided = bucket.success.n;
  return {
    assetId,
    observed: bucket.total,
    trainable: bucket.trainable,
    excluded: bucket.excluded,
    decided,
    detected: detectedFor(patterns, assetId),
    validated: validatedFor(validation, assetId),
    phase: phaseOf(decided),
    gate: evidenceGate(decided),
  };
}

function cumulativeSeries(cases: LearningCase[]): EvolutionDay[] {
  if (!cases.length) return [];
  const sorted = [...cases].sort((a, b) => a.openedAtMs - b.openedAtMs);
  const dayOf: { key: string; label: string; openedAtMs: number }[] = [];
  const days: { key: string; label: string; openedAtMs: number }[] = [];
  const seen = new Set<string>();
  for (const c of sorted) {
    const d = madridDayKey(c.openedAtMs);
    dayOf.push(d);
    if (!Number.isFinite(c.openedAtMs) || c.openedAtMs <= 0) continue;
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    days.push(d);
  }

  let end = 0;
  return days.map((d) => {
    while (end < sorted.length && dayOf[end]!.key <= d.key) end++;
    const prefix = sorted.slice(0, end);
    const train = prefix.filter((c) => c.trainable);
    const patterns = detectFindings(prefix);
    const testN = splitTemporal(productionCases(prefix)).test.length;
    const validated =
      testN < MIN_TEST_N ? 0 : runValidation(prefix, d.openedAtMs).validated;
    return {
      day: d.key,
      label: d.label,
      openedAtMs: d.openedAtMs,
      observed: prefix.length,
      trainable: train.length,
      detected: patterns.highlighted.length,
      validated,
    };
  });
}

export function buildEvolution(
  cases: LearningCase[],
  patterns: PatternReport,
  validation: ValidationReport,
  window = LEARN_HISTORY_WINDOW,
): EvolutionReport {
  const setupStats = summarize(cases);
  const tradeStats = summarize(v1TradeCases(cases));
  const observed = setupStats.global.total;
  const trainable = setupStats.global.trainable;
  const excluded = setupStats.global.excluded;
  const decided = tradeStats.global.success.n;
  const tradeByAsset = new Map(tradeStats.byAsset.map((b) => [b.key, b]));
  return {
    window,
    truncated: observed >= window,
    observed,
    trainable,
    excluded,
    decided,
    detected: patterns.highlighted.length,
    validated: validation.validated,
    rejected: validation.rejected,
    inconclusive: validation.inconclusive,
    phase: phaseOf(decided),
    gate: evidenceGate(decided),
    byAsset: setupStats.byAsset.map((bucket) =>
      assetSlice(
        {
          ...bucket,
          success: (tradeByAsset.get(bucket.key) ?? bucket).success,
        },
        patterns,
        validation,
      ),
    ),
    series: cumulativeSeries(cases),
    notice: EVOLUTION_NOTICE,
    barNotice: EVIDENCE_BAR_NOTICE,
  };
}
