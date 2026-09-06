import type { AssetId } from "@/lib/trading/types";
import type { RadarCase, ShadowRadar } from "./shadow-radar";

export interface AutopsyGroup {
  key: string;
  label: string;
  cases: number;
  matureCases: number;
  tp1OrBetter: number;
  avgMfeR: number | null;
  avgMaeR: number | null;
}

export interface AutopsyCase {
  episodeId: string;
  assetId: AssetId;
  direction: "buy" | "sell";
  verdict: string;
  mature: boolean;
  missingForEntry: string | null;
  waitReason: string | null;
  setupKind: string | null;
  quality: string | null;
  bias4h: string | null;
  highImpact: boolean;
  mfeR: number | null;
  maeR: number | null;
  firstTouch: string | null;
}

export interface ShadowAutopsy {
  groups: AutopsyGroup[];
  cases: AutopsyCase[];
  conclusion: string;
}

function groupKey(c: RadarCase): string {
  return [c.missingForEntry ?? "sin-motivo", c.setupKind ?? "sin-setup", c.bias4h ?? "sin-bias"].join("|");
}

function groupLabel(c: RadarCase): string {
  return `${c.missingForEntry ?? "Sin motivo capturado"} · ${c.setupKind ?? "sin setup"} · 4H ${c.bias4h ?? "sin dato"}`;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export function buildShadowAutopsy(radar: ShadowRadar): ShadowAutopsy {
  const groups = new Map<string, RadarCase[]>();
  for (const c of radar.cases) {
    const key = groupKey(c);
    const rows = groups.get(key) ?? [];
    rows.push(c);
    groups.set(key, rows);
  }

  const summaries = [...groups.entries()].map(([key, rows]) => {
    // Open/in-progress cases remain visible, but never contribute to result statistics.
    const mature = rows.filter((c) => c.mature);
    return {
      key,
      label: groupLabel(rows[0]),
      cases: rows.length,
      matureCases: mature.length,
      tp1OrBetter: mature.filter((c) => c.firstTouch === "tp1" || c.firstTouch === "tp2").length,
      avgMfeR: mean(mature.map((c) => c.mfeR).filter((v): v is number => v != null)),
      avgMaeR: mean(mature.map((c) => c.maeR).filter((v): v is number => v != null)),
    };
  }).sort((a, b) => b.matureCases - a.matureCases || b.cases - a.cases || (b.avgMfeR ?? 0) - (a.avgMfeR ?? 0));

  const cases = radar.cases.map((c) => ({
    episodeId: c.episodeId,
    assetId: c.assetId,
    direction: c.direction,
    verdict: c.firstTouch === "tp2" ? "TP2 alcanzado" : c.firstTouch === "tp1" ? "TP1 alcanzado" : "≥1R alcanzado sin TP",
    mature: c.mature,
    missingForEntry: c.missingForEntry,
    waitReason: c.waitReason,
    setupKind: c.setupKind,
    quality: c.quality,
    bias4h: c.bias4h,
    highImpact: c.highImpact,
    mfeR: c.mfeR,
    maeR: c.maeR,
    firstTouch: c.firstTouch,
  }));

  const matureTotal = radar.cases.filter((c) => c.mature).length;
  const conclusion = summaries.length
    ? `Se han agrupado ${radar.cases.length} oportunidades por motivo de no entrada, setup y sesgo 4H. ${matureTotal} están maduras; solo ellas alimentan las estadísticas. Los grupos son descriptivos: no implican cambios en V1.`
    : "Todavía no hay suficientes oportunidades ≥1R para realizar una autopsia.";
  return { groups: summaries, cases, conclusion };
}
