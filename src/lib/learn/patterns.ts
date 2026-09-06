import type { AssetId } from "../trading/types";
import type { LearningCase } from "./case";
import { v1TradeCases } from "./case";
import {
  ASSET_ORDER,
  evidenceLevel,
  formatMadridDate,
  rrBand,
  summarize,
  type EvidenceLevel,
  type Rate,
} from "./stats";

/** Closed list. No combinatorial search. */
export const MIN_DELTA_PP = 5;
export const FINDING_NOTICE = "Esto es una observación histórica. No modifica V1.";

export type FindingTone = "positive" | "negative";

export interface Finding {
  id: string;
  assetId: AssetId | "GLOBAL";
  dim: string;
  cut: string;
  label: string;
  groupN: number;
  groupRate: Rate;
  baselineN: number;
  baselineRate: Rate;
  deltaPp: number | null;
  evidence: EvidenceLevel;
  tone: FindingTone;
  periodFromMs: number | null;
  periodToMs: number | null;
  limitedInTime: boolean;
  wilsonCaution: boolean;
  text: string;
  notice: string;
}

export interface PatternReport {
  findings: Finding[];
  highlighted: Finding[];
  insufficient: number;
  emptyLabel: string;
}

type Cut = {
  dim: string;
  cut: string;
  label: string;
  pred: (c: LearningCase) => boolean;
};

function madridHour(ms: number): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  return Number.parseInt(h, 10);
}

const CUTS: Cut[] = [
  { dim: "direction", cut: "buy", label: "COMPRA", pred: (c) => c.direction === "buy" },
  { dim: "direction", cut: "sell", label: "VENTA", pred: (c) => c.direction === "sell" },
  { dim: "kind", cut: "continuation", label: "continuación", pred: (c) => c.kind === "continuation" },
  { dim: "kind", cut: "break-retest", label: "ruptura + retest", pred: (c) => c.kind === "break-retest" },
  { dim: "quality", cut: "alta", label: "calidad alta", pred: (c) => c.quality === "alta" },
  { dim: "quality", cut: "media", label: "calidad media", pred: (c) => c.quality === "media" },
  { dim: "rr", cut: "lt2", label: "R:R < 2", pred: (c) => rrBand(c.riskReward) === "lt2" },
  { dim: "rr", cut: "2to3", label: "R:R 2–3", pred: (c) => rrBand(c.riskReward) === "2to3" },
  { dim: "rr", cut: "gte3", label: "R:R ≥ 3", pred: (c) => rrBand(c.riskReward) === "gte3" },
  { dim: "impact", cut: "true", label: "alto impacto", pred: (c) => c.highImpact === true },
  { dim: "impact", cut: "false", label: "sin alto impacto", pred: (c) => c.highImpact === false },
  { dim: "session", cut: "00-08", label: "sesión 00–08 Madrid", pred: (c) => madridHour(c.openedAtMs) < 8 },
  { dim: "session", cut: "08-16", label: "sesión 08–16 Madrid", pred: (c) => { const h = madridHour(c.openedAtMs); return h >= 8 && h < 16; } },
  { dim: "session", cut: "16-24", label: "sesión 16–24 Madrid", pred: (c) => madridHour(c.openedAtMs) >= 16 },
];

export function filterByCut(cases: LearningCase[], dim: string, cut: string): LearningCase[] {
  const spec = CUTS.find((c) => c.dim === dim && c.cut === cut);
  if (!spec) return [];
  return cases.filter(spec.pred);
}

export function assetUniverse(cases: LearningCase[], asset: AssetId | "GLOBAL"): LearningCase[] {
  if (asset === "GLOBAL") return cases;
  return cases.filter((c) => c.assetId === asset);
}

export function productionCases(cases: LearningCase[]): LearningCase[] {
  return cases.filter((c) => c.origin !== "test");
}

function wilsonOverlap(a: Rate, b: Rate): boolean {
  if (a.wilsonLow == null || a.wilsonHigh == null || b.wilsonLow == null || b.wilsonHigh == null) return true;
  return a.wilsonLow <= b.wilsonHigh && b.wilsonLow <= a.wilsonHigh;
}

function limitedInTime(group: LearningCase[], baselinePct: number | null): boolean {
  const sorted = [...group].filter((c) => c.trainable).sort((a, b) => a.openedAtMs - b.openedAtMs);
  if (sorted.length < 20) return false;
  const mid = Math.floor(sorted.length / 2);
  const a = summarize(sorted.slice(0, mid)).global.success;
  const b = summarize(sorted.slice(mid)).global.success;
  if (a.n < 8 || b.n < 8 || a.pct == null || b.pct == null || baselinePct == null) return false;
  const da = a.pct - baselinePct;
  const db = b.pct - baselinePct;
  return da * db < 0;
}

function classifyEvidence(n: number, _wilsonCaution: boolean): EvidenceLevel {
  return evidenceLevel(n);
}

function findingOf(
  assetId: AssetId | "GLOBAL",
  cut: Cut,
  group: LearningCase[],
  baseline: ReturnType<typeof summarize>["global"],
): Finding {
  const g = summarize(group).global;
  const deltaPp =
    g.success.pct != null && baseline.success.pct != null ? (g.success.pct - baseline.success.pct) * 100 : null;
  const caution = wilsonOverlap(g.success, baseline.success);
  const n = g.success.n;
  let evidence: EvidenceLevel = evidenceLevel(n);
  if (n >= 20 && (deltaPp == null || Math.abs(deltaPp) < MIN_DELTA_PP)) {
    evidence = n < 20 ? "insufficient" : evidence;
  }
  if (n < 20) evidence = "insufficient";
  else if (deltaPp != null && Math.abs(deltaPp) >= MIN_DELTA_PP) {
    evidence = classifyEvidence(n, caution);
  } else {
    evidence = "insufficient";
  }
  const tone: FindingTone = (deltaPp ?? 0) >= 0 ? "positive" : "negative";
  const limited = limitedInTime(group, baseline.success.pct);
  const periodFrom = g.periodFromMs;
  const periodTo = g.periodToMs;
  const pct = (r: Rate) => (r.pct == null ? "n/d" : `${(r.pct * 100).toFixed(0)} %`);
  const dir =
    tone === "positive" ? "mayor frecuencia que el conjunto" : "peor resultado histórico que el baseline";
  return {
    id: `${assetId}:${cut.dim}:${cut.cut}`,
    assetId,
    dim: cut.dim,
    cut: cut.cut,
    label: `${assetId} · ${cut.label}`,
    groupN: n,
    groupRate: g.success,
    baselineN: baseline.success.n,
    baselineRate: baseline.success,
    deltaPp,
    evidence,
    tone,
    periodFromMs: periodFrom,
    periodToMs: periodTo,
    limitedInTime: limited,
    wilsonCaution: caution,
    text:
      n < 20
        ? `${assetId} ${cut.label}: n=${n}. Evidencia insuficiente.`
        : `En el histórico de Atalaya, los casos ${cut.label} de ${assetId} presentan ${dir} (${pct(g.success)} vs ${pct(baseline.success)}, n=${n}).`,
    notice: FINDING_NOTICE,
  };
}

export function isHighlighted(f: Finding): boolean {
  if (f.groupN < 20) return false;
  if (f.deltaPp == null || Math.abs(f.deltaPp) < MIN_DELTA_PP) return false;
  return f.evidence !== "insufficient";
}

export function detectFindings(
  cases: LearningCase[],
  opts?: { dataset?: "production" | "all" },
): PatternReport {
  const dataset = opts?.dataset ?? "production";
  const src = v1TradeCases(dataset === "all" ? cases : productionCases(cases));
  const emptyLabel = "Aún no hay suficiente histórico para detectar patrones.";
  const findings: Finding[] = [];

  for (const asset of ASSET_ORDER) {
    const assetCases = src.filter((c) => c.assetId === asset);
    const baseline = summarize(assetCases).global;
    for (const cut of CUTS) {
      const group = assetCases.filter(cut.pred);
      if (group.length === 0) continue;
      findings.push(findingOf(asset, cut, group, baseline));
    }
  }

  // Global only if ≥3 assets share sign + highlighted on the same cut.
  for (const cut of CUTS) {
    const same = findings.filter((f) => f.dim === cut.dim && f.cut === cut.cut && isHighlighted(f));
    const pos = same.filter((f) => f.tone === "positive");
    const neg = same.filter((f) => f.tone === "negative");
    const pack = pos.length >= 3 ? pos : neg.length >= 3 ? neg : [];
    if (pack.length < 3) continue;
    const all = src.filter(cut.pred);
    const baseline = summarize(src).global;
    const f = findingOf("GLOBAL", cut, all, baseline);
    f.text = `Coherente en ${pack.map((p) => p.assetId).join(", ")}. ${f.text}`;
    findings.push(f);
  }

  findings.sort((a, b) => {
    const da = Math.abs(a.deltaPp ?? 0);
    const db = Math.abs(b.deltaPp ?? 0);
    if (db !== da) return db - da;
    return a.id.localeCompare(b.id);
  });

  const highlighted = findings.filter(isHighlighted);
  return {
    findings,
    highlighted,
    insufficient: findings.filter((f) => f.evidence === "insufficient").length,
    emptyLabel: highlighted.length ? "" : emptyLabel,
  };
}
