import type { AssetId } from "@/lib/trading/types";
import type { HistoryRow } from "@/lib/watch/store";

export interface RadarCase {
  episodeId: string;
  assetId: AssetId;
  direction: "buy" | "sell";
  openedAtMs: number;
  state: string;
  hadV1Entry: boolean;
  outcome: string | null;
  firstTouch: string | null;
  mature: boolean;
  mfe: number | null;
  mae: number | null;
  riskUnit: number;
  mfeR: number | null;
  maeR: number | null;
  waitReason: string | null;
  bias4h: string | null;
  setupKind: string | null;
  quality: string | null;
  warnings: string[];
  highImpact: boolean;
  missingForEntry: string | null;
  volumeRatio15: number | null;
  volumeRatio4h: number | null;
  replay: { entry: number; sl: number; tp1: number; tp2: number | null; zoneLow: number; zoneHigh: number };
}

export interface RadarStats {
  evaluated: number;
  matureEvaluated: number;
  missed: number;
  matureMissed: number;
  favorable: number;
  tp1OrBetter: number;
  favorableRate: number | null;
  byAsset: Array<{ assetId: AssetId; cases: number; favorable: number; rate: number | null }>;
}

export interface ShadowRadar { cases: RadarCase[]; stats: RadarStats; rule: string; }

function riskUnit(row: HistoryRow): number {
  const ep = row.episode;
  const entry = ep.direction === "buy" ? ep.zoneLow : ep.zoneHigh;
  return Math.abs(entry - ep.sl);
}

function toCase(row: HistoryRow): RadarCase {
  const ep = row.episode;
  const freeze = ep.freeze;
  const ru = riskUnit(row);
  return {
    episodeId: ep.episodeId, assetId: ep.assetId, direction: ep.direction, openedAtMs: ep.openedAtMs,
    state: ep.openedState, hadV1Entry: row.hadV1Entry === true, outcome: row.outcome,
    firstTouch: row.firstTouch, mature: row.outcome != null,
    mfe: row.mfe, mae: row.mae, riskUnit: ru,
    mfeR: row.mfe == null || ru <= 0 ? null : row.mfe / ru,
    maeR: row.mae == null || ru <= 0 ? null : row.mae / ru,
    waitReason: freeze?.waitReason ?? null, bias4h: freeze?.bias4hLabel ?? null,
    setupKind: freeze?.setupKind ?? null, quality: freeze?.quality ?? null,
    warnings: freeze?.warnings ?? [], highImpact: freeze?.highImpact === true,
    missingForEntry: freeze?.missingForEntry ?? null,
    volumeRatio15: freeze?.volumeRatio15 ?? null, volumeRatio4h: freeze?.volumeRatio4h ?? null,
    replay: { entry: ep.direction === "buy" ? ep.zoneLow : ep.zoneHigh, sl: ep.sl, tp1: ep.tp1, tp2: ep.tp2, zoneLow: ep.zoneLow, zoneHigh: ep.zoneHigh },
  };
}

export function buildShadowRadar(history: HistoryRow[]): ShadowRadar {
  const evaluatedRows = history.filter((row) => row.hadV1Entry !== true && row.mfe != null && row.mfe > 0);
  const allCases = evaluatedRows.map(toCase).filter((c) => c.mfeR != null && c.mfeR >= 1).sort((a, b) => b.openedAtMs - a.openedAtMs);
  const matureCases = allCases.filter((c) => c.mature);
  const byAsset = [...new Set(allCases.map((c) => c.assetId))].map((assetId) => {
    const rows = allCases.filter((c) => c.assetId === assetId);
    const favorable = rows.filter((c) => (c.mfeR ?? 0) >= 1).length;
    return { assetId, cases: rows.length, favorable, rate: rows.length ? Math.round((favorable / rows.length) * 1000) / 10 : null };
  });
  return {
    cases: allCases,
    stats: {
      evaluated: evaluatedRows.length, matureEvaluated: evaluatedRows.filter((r) => r.outcome != null).length,
      missed: allCases.length, matureMissed: matureCases.length, favorable: allCases.length,
      tp1OrBetter: allCases.filter((c) => c.firstTouch === "tp1" || c.firstTouch === "tp2").length,
      favorableRate: evaluatedRows.length ? Math.round((allCases.length / evaluatedRows.length) * 1000) / 10 : null,
      byAsset,
    },
    rule: "Radar descriptivo: episodio sin ENTRY V1 + MFE ≥ 1R. `mature` indica que existe outcome; los casos abiertos no se usan como evidencia de resultado.",
  };
}

export function replayLabel(c: RadarCase): string {
  if (c.firstTouch === "tp2") return "TP2 alcanzado";
  if (c.firstTouch === "tp1") return "TP1 alcanzado";
  if (c.firstTouch === "sl") return "SL alcanzado";
  if (c.mfeR != null && c.mfeR >= 1) return "Avance ≥ 1R sin toque final";
  return "Sin desenlace";
}
