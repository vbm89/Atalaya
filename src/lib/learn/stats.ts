import type { AssetId } from "../trading/types";
import type { LearningCase } from "./case";

export const ASSET_ORDER: AssetId[] = ["XAUUSD", "BTCUSD", "US100", "WTI"];

export type EvidenceLevel = "insufficient" | "observation" | "potential_pattern" | "stronger";

export type RrBand = "lt2" | "2to3" | "gte3" | "unknown";

export interface Rate {
  hits: number;
  n: number;
  pct: number | null;
  wilsonLow: number | null;
  wilsonHigh: number | null;
}

export interface BucketStats {
  key: string;
  label: string;
  total: number;
  trainable: number;
  excluded: number;
  tp1: number;
  tp2: number;
  sl: number;
  expired: number;
  pending: number;
  /** Success = TP1 or TP2 (one trade). Denominator = TP1+TP2+SL. EXPIRADA aparte. */
  success: Rate;
  fail: Rate;
  tp2Share: Rate;
  expiredShare: Rate;
  evidence: EvidenceLevel;
  periodFromMs: number | null;
  periodToMs: number | null;
  meanDurationMs: number | null;
  medianDurationMs: number | null;
  meanTouchMs: number | null;
  meanMfe: number | null;
  meanMae: number | null;
}

export interface StatsReport {
  global: BucketStats;
  byAsset: BucketStats[];
  byDirection: BucketStats[];
  byKind: BucketStats[];
  byQuality: BucketStats[];
  byRr: BucketStats[];
  byImpact: BucketStats[];
  byMonth: BucketStats[];
  disclaimer: string;
  mixWarning: string;
}

export const STATS_DISCLAIMER =
  "Los resultados son históricos y no garantizan resultados futuros. No son operaciones ejecutadas.";
export const MIX_WARNING =
  "Los resultados combinan activos con comportamientos diferentes. La vista por activo es la principal.";

export function evidenceLevel(n: number): EvidenceLevel {
  if (n < 20) return "insufficient";
  if (n < 50) return "observation";
  if (n < 80) return "potential_pattern";
  return "stronger";
}

export function evidenceLabel(level: EvidenceLevel): string {
  if (level === "insufficient") return "Aún no hay muestra suficiente.";
  if (level === "observation") return "Observación. Muestra limitada.";
  if (level === "potential_pattern") return "Patrón potencial — no validado. No cambia V1.";
  return "Evidencia más sólida. No implica cambiar V1.";
}

/** Wilson 95 %. Null if n = 0. Never fake precision on empty samples. */
export function wilsonInterval(hits: number, n: number): { low: number; high: number } | null {
  if (!Number.isFinite(hits) || !Number.isFinite(n) || n <= 0) return null;
  const z = 1.96;
  const p = hits / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / den;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

export function rate(hits: number, n: number): Rate {
  const w = wilsonInterval(hits, n);
  return {
    hits,
    n,
    pct: n > 0 ? hits / n : null,
    wilsonLow: w?.low ?? null,
    wilsonHigh: w?.high ?? null,
  };
}

export function rrBand(rr: number | null): RrBand {
  if (rr == null || !Number.isFinite(rr)) return "unknown";
  if (rr < 2) return "lt2";
  if (rr < 3) return "2to3";
  return "gte3";
}

export function rrBandLabel(band: RrBand): string {
  if (band === "lt2") return "R:R < 2";
  if (band === "2to3") return "R:R 2–3";
  if (band === "gte3") return "R:R ≥ 3";
  return "R:R n/d";
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function madridMonth(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${y}-${m}`;
}

export function formatMadridDate(ms: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(ms));
}

export function periodLabel(fromMs: number | null, toMs: number | null): string {
  if (fromMs == null || toMs == null) return "Sin periodo";
  return `${formatMadridDate(fromMs)} – ${formatMadridDate(toMs)}`;
}

export function formatPct(r: Rate): string {
  if (r.pct == null || r.n === 0) return `n = ${r.n} · % n/d`;
  const pct = (r.pct * 100).toFixed(1).replace(".", ",");
  return `${pct} %  (n = ${r.n})`;
}

function bucketOf(key: string, label: string, cases: LearningCase[]): BucketStats {
  let tp1 = 0;
  let tp2 = 0;
  let sl = 0;
  let expired = 0;
  let pending = 0;
  let trainable = 0;
  let excluded = 0;
  const durations: number[] = [];
  const touches: number[] = [];
  const mfes: number[] = [];
  const maes: number[] = [];
  let from: number | null = null;
  let to: number | null = null;

  for (const c of cases) {
    if (c.trainable) {
      trainable += 1;
      if (from == null || c.openedAtMs < from) from = c.openedAtMs;
      if (to == null || c.openedAtMs > to) to = c.openedAtMs;
      if (c.outcome === "tp1") tp1 += 1;
      else if (c.outcome === "tp2") tp2 += 1;
      else if (c.outcome === "sl") sl += 1;
      else if (c.outcome === "expired") expired += 1;
      if (c.durationMs != null && Number.isFinite(c.durationMs)) durations.push(c.durationMs);
      if (c.firstTouchAtMs != null && c.openedAtMs > 0) {
        const d = c.firstTouchAtMs - c.openedAtMs;
        if (d >= 0) touches.push(d);
      }
      if (c.mfe != null && Number.isFinite(c.mfe)) mfes.push(c.mfe);
      if (c.mae != null && Number.isFinite(c.mae)) maes.push(c.mae);
    } else {
      excluded += 1;
      if (c.exclusionReason === "OUTCOME_PENDING" || c.outcome === "pending" || c.outcome == null) {
        pending += 1;
      }
    }
  }

  const decided = tp1 + tp2 + sl;
  const successes = tp1 + tp2;
  return {
    key,
    label,
    total: cases.length,
    trainable,
    excluded,
    tp1,
    tp2,
    sl,
    expired,
    pending,
    success: rate(successes, decided),
    fail: rate(sl, decided),
    tp2Share: rate(tp2, decided),
    expiredShare: rate(expired, trainable),
    evidence: evidenceLevel(decided),
    periodFromMs: from,
    periodToMs: to,
    meanDurationMs: mean(durations),
    medianDurationMs: median(durations),
    meanTouchMs: mean(touches),
    meanMfe: mean(mfes),
    meanMae: mean(maes),
  };
}

export function summarize(cases: LearningCase[]): StatsReport {
  const byAsset = ASSET_ORDER.map((id) =>
    bucketOf(id, id, cases.filter((c) => c.assetId === id)),
  );
  const byDirection = [
    bucketOf("buy", "COMPRA", cases.filter((c) => c.direction === "buy")),
    bucketOf("sell", "VENTA", cases.filter((c) => c.direction === "sell")),
  ];
  const kinds = ["continuation", "break-retest"] as const;
  const byKind = [
    ...kinds.map((k) =>
      bucketOf(k, k === "continuation" ? "continuación" : "ruptura + retest", cases.filter((c) => c.kind === k)),
    ),
    bucketOf("other", "otro", cases.filter((c) => c.kind !== "continuation" && c.kind !== "break-retest")),
  ];
  const qualities = ["alta", "media", "baja"] as const;
  const byQuality = [
    ...qualities.map((q) => bucketOf(q, q, cases.filter((c) => c.quality === q))),
    bucketOf("nd", "calidad n/d", cases.filter((c) => c.quality == null || !qualities.includes(c.quality as (typeof qualities)[number]))),
  ];
  const rrKeys: RrBand[] = ["lt2", "2to3", "gte3", "unknown"];
  const byRr = rrKeys.map((b) => bucketOf(b, rrBandLabel(b), cases.filter((c) => rrBand(c.riskReward) === b)));
  const byImpact = [
    bucketOf("impact", "alto impacto", cases.filter((c) => c.highImpact === true)),
    bucketOf("no-impact", "sin alto impacto", cases.filter((c) => c.highImpact === false)),
    bucketOf("impact-nd", "impacto n/d", cases.filter((c) => c.highImpact == null)),
  ];
  const months = new Set<string>();
  for (const c of cases) {
    if (c.trainable && c.openedAtMs > 0) months.add(madridMonth(c.openedAtMs));
  }
  const byMonth = [...months].sort().map((m) =>
    bucketOf(
      m,
      m,
      cases.filter((c) => c.trainable && c.openedAtMs > 0 && madridMonth(c.openedAtMs) === m),
    ),
  );

  return {
    global: bucketOf("global", "Todos los activos", cases),
    byAsset,
    byDirection,
    byKind,
    byQuality,
    byRr,
    byImpact,
    byMonth,
    disclaimer: STATS_DISCLAIMER,
    mixWarning: MIX_WARNING,
  };
}
