import type { AssetId } from "@/lib/trading/types";
import type { RadarCase, ShadowRadar } from "./shadow-radar";

export interface AutopsyGroup {
  key: string;
  label: string;
  cases: number;
  tp1OrBetter: number;
  avgMfeR: number | null;
  avgMaeR: number | null;
}

export interface AutopsyCase {
  episodeId: string;
  assetId: AssetId;
  direction: "buy" | "sell";
  verdict: string;
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

export function buildShadowAutopsy(radar: ShadowRadar): ShadowAutopsy {
  const groups = new Map<string, RadarCase[]>();
  for (const c of radar.cases) {
    const key = groupKey(c);
    const rows = groups.get(key) ?? [];
    rows.push(c);
    groups.set(key, rows);
  }

  const summaries = [...groups.entries()].map(([key, rows]) => ({
    key,
    label: groupLabel(rows[0]),
    cases: rows.length,
    tp1OrBetter: rows.filter((c) => c.firstTouch === "tp1" || c.firstTouch === "tp2").length,
    avgMfeR: rows.length ? Math.round((rows.reduce((s, c) => s + (c.mfeR ?? 0), 0) / rows.length) * 100) / 100 : null,
    avgMaeR: rows.length ? Math.round((rows.reduce((s, c) => s + (c.maeR ?? 0), 0) / rows.length) * 100) / 100 : null,
  })).sort((a, b) => b.cases - a.cases || (b.avgMfeR ?? 0) - (a.avgMfeR ?? 0));

  const cases = radar.cases.map((c) => ({
    episodeId: c.episodeId,
    assetId: c.assetId,
    direction: c.direction,
    verdict: c.firstTouch === "tp2" ? "TP2 alcanzado" : c.firstTouch === "tp1" ? "TP1 alcanzado" : "≥1R alcanzado sin TP",
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

  const conclusion = summaries.length
    ? `Se han agrupado ${radar.cases.length} oportunidades por motivo de no entrada, setup y sesgo 4H. Los grupos son descriptivos: no implican que ninguna condición deba añadirse a V1.`
    : "Todavía no hay suficientes oportunidades ≥1R para realizar una autopsia.";

  return { groups: summaries, cases, conclusion };
}
