import type { ShadowAutopsy } from "./shadow-autopsy";

export interface PatternSignal {
  key: string;
  label: string;
  cases: number;
  tpRate: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  evidence: "INSUFFICIENT" | "DESCRIPTIVE";
}

export interface ShadowPatternReport {
  patterns: PatternSignal[];
  totalCases: number;
  note: string;
}

export function buildShadowPatternReport(autopsy: ShadowAutopsy): ShadowPatternReport {
  const patterns = autopsy.groups.map((g) => ({
    key: g.key,
    label: g.label,
    cases: g.cases,
    tpRate: g.cases ? Math.round((g.tp1OrBetter / g.cases) * 1000) / 10 : null,
    avgMfeR: g.avgMfeR,
    avgMaeR: g.avgMaeR,
    evidence: "DESCRIPTIVE" as const,
  }));
  return { patterns, totalCases: autopsy.cases.length, note: "Los patrones solo describen repeticiones observadas. No se convierten en reglas V1 ni se optimizan con TEST." };
}
