import type { ShadowCaseInput, ShadowFeatureVector } from "./shadow-features";
import { toShadowFeatures } from "./shadow-features";

export type ShadowCandidateReason =
  | "BASELINE_V1"
  | "VOLUME_RELAXED"
  | "TRIGGER_RELAXED"
  | "VOLUME_AND_TRIGGER_RELAXED";

export const SHADOW_VARIANTS: readonly ShadowCandidateReason[] = [
  "BASELINE_V1",
  "VOLUME_RELAXED",
  "TRIGGER_RELAXED",
  "VOLUME_AND_TRIGGER_RELAXED",
] as const;

export interface ShadowTapeBar {
  episodeId: string;
  tf: "15m" | "1h" | "4h";
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  role: "lookback" | "forward";
}

export interface ShadowSignalEvent {
  episodeId: string;
  fromState: string;
  toState: string;
  atMs: number;
  slot: number;
}

export interface ShadowEpisode {
  case: ShadowCaseInput;
  events: readonly ShadowSignalEvent[];
  bars: readonly ShadowTapeBar[];
  /** Stored V1 outcome is validation evidence only; candidate generation never reads it. */
  observedOutcome?: string | null;
}

export interface ShadowCandidate {
  episodeId: string;
  variant: ShadowCandidateReason;
  decisionSlot: number;
  decisionBarTime: number;
  trigger: "fail_accept" | "reject" | "retest" | "none";
  triggerVolumeRatio: number | null;
  triggerVolumeAvailable: boolean;
  features: ShadowFeatureVector;
}

export type ShadowOutcome = "pending" | "sl" | "tp1" | "tp2" | "expired";

export interface ShadowCandidateResult extends ShadowCandidate {
  outcome: ShadowOutcome;
  firstTouchAtSec: number | null;
  rrAtOutcome: number | null;
  dataComplete: boolean;
}

export interface RateSummary {
  n: number;
  hits: number;
  pct: number | null;
  wilsonLow: number | null;
  wilsonHigh: number | null;
}

export interface ShadowBreakdown {
  key: string;
  n: number;
  tp1: number;
  tp2: number;
  sl: number;
  expired: number;
  success: RateSummary;
  falsePositives: number;
}

export interface ShadowVariantReport {
  variant: ShadowCandidateReason;
  candidates: number;
  entries: number;
  additionalOpportunities: number;
  tp1: number;
  tp2: number;
  sl: number;
  expired: number;
  decided: number;
  success: RateSummary;
  meanPlannedRr: number | null;
  meanOutcomeRr: number | null;
  falsePositives: number;
  byAsset: ShadowBreakdown[];
  byDirection: ShadowBreakdown[];
  bySession: ShadowBreakdown[];
  byQuality: ShadowBreakdown[];
  byKind: ShadowBreakdown[];
  byVolume: ShadowBreakdown[];
  byTrigger: ShadowBreakdown[];
  train: ShadowBreakdown;
  test: ShadowBreakdown;
  storedOutcomeAgreement: number | null;
}

export interface ShadowReplayReport {
  episodesAnalyzed: number;
  episodesWith15mTape: number;
  episodesWithGaps: number;
  variants: ShadowVariantReport[];
  limitations: string[];
}

const VOL_TRIGGER = 1;
const VOL_DEAD = 0.3;
const VOL_4H_DEAD = 0.25;
const LATE_R = 0.3;
const STEP_15M = 900;
const STEP_1H = 3600;
const STEP_4H = 14400;

function wilson(hits: number, n: number): RateSummary {
  if (n <= 0) return { n: 0, hits, pct: null, wilsonLow: null, wilsonHigh: null };
  const z = 1.96;
  const p = hits / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / den;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / den;
  return {
    n,
    hits,
    pct: p,
    wilsonLow: Math.max(0, center - margin),
    wilsonHigh: Math.min(1, center + margin),
  };
}

function finite(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function priorVolumeRatio(bars: readonly ShadowTapeBar[], index: number): number | null {
  const start = Math.max(0, index - 20);
  const vols = bars.slice(start, index).map((b) => b.v).filter((v): v is number => v != null && v > 0);
  const v = bars[index]?.v;
  if (!vols.length || v == null || v <= 0) return null;
  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  return avg > 0 ? v / avg : null;
}

function overlaps(b: ShadowTapeBar, low: number, high: number): boolean {
  return b.h >= low && b.l <= high;
}

function third(b: ShadowTapeBar, upper: boolean): boolean {
  const range = b.h - b.l;
  if (range <= 0) return false;
  const pos = (b.c - b.l) / range;
  return upper ? pos >= 2 / 3 : pos <= 1 / 3;
}

function failAccept(b: ShadowTapeBar, c: ShadowCaseInput): boolean {
  if (c.invalidation == null || !overlaps(b, c.zoneLow, c.zoneHigh)) return false;
  return c.direction === "sell"
    ? b.c < c.zoneLow && b.c < c.invalidation
    : b.c > c.zoneHigh && b.c > c.invalidation;
}

function reject(b: ShadowTapeBar, c: ShadowCaseInput): boolean {
  if (c.invalidation == null || !overlaps(b, c.zoneLow, c.zoneHigh)) return false;
  const mid = (c.zoneLow + c.zoneHigh) / 2;
  const depth = c.zoneHigh - c.zoneLow;
  if (c.direction === "sell") {
    const reached = b.h >= c.zoneLow + 0.5 * depth || b.h >= c.zoneHigh;
    return b.c <= mid && third(b, false) && b.c < b.o && b.c < c.invalidation && reached;
  }
  const reached = b.l <= c.zoneHigh - 0.5 * depth || b.l <= c.zoneLow;
  return b.c >= mid && third(b, true) && b.c > b.o && b.c > c.invalidation && reached;
}

function structureBias(bars: readonly ShadowTapeBar[]): "buy" | "sell" | null {
  const valid = bars.filter((b) => Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c));
  if (valid.length < 8) return null;
  const highs: Array<{ i: number; p: number }> = [];
  const lows: Array<{ i: number; p: number }> = [];
  for (let i = 2; i < valid.length - 2; i += 1) {
    if (
      valid[i]!.h > valid[i - 1]!.h &&
      valid[i]!.h > valid[i - 2]!.h &&
      valid[i]!.h > valid[i + 1]!.h &&
      valid[i]!.h > valid[i + 2]!.h
    ) highs.push({ i, p: valid[i]!.h });
    if (
      valid[i]!.l < valid[i - 1]!.l &&
      valid[i]!.l < valid[i - 2]!.l &&
      valid[i]!.l < valid[i + 1]!.l &&
      valid[i]!.l < valid[i + 2]!.l
    ) lows.push({ i, p: valid[i]!.l });
  }
  if (highs.length < 2 || lows.length < 2) return null;
  const lastH = highs.at(-1)!;
  const prevH = highs.at(-2)!;
  const lastL = lows.at(-1)!;
  const prevL = lows.at(-2)!;
  if (lastH.p > prevH.p && lastL.p > prevL.p) return "buy";
  if (lastH.p < prevH.p && lastL.p < prevL.p) return "sell";
  return null;
}

function current4hBias(bars: readonly ShadowTapeBar[], decisionBarTime: number): "buy" | "sell" | null {
  return structureBias(
    bars
      .filter((b) => b.tf === "4h" && b.t <= decisionBarTime)
      .sort((a, b) => a.t - b.t),
  );
}

function late(c: ShadowCaseInput, bar: ShadowTapeBar): boolean {
  const path = Math.abs(c.tp1 - c.entry);
  if (path <= 0) return true;
  const traveled = c.direction === "sell" ? c.zoneLow - bar.c : bar.c - c.zoneHigh;
  return traveled >= LATE_R * path;
}

function nonRelaxedGatesPass(ep: ShadowEpisode, bars15: readonly ShadowTapeBar[], barIndex: number): boolean {
  const c = ep.case;
  const b = bars15[barIndex];
  if (!b) return false;
  if (c.highImpact === true || c.underlyingClosed === true) return false;
  if (c.dataStatus === "error" || c.dataStatus === "insufficient") return false;
  if (late(c, b)) return false;
  const h4 = current4hBias(ep.bars, b.t);
  if (h4 != null && h4 !== c.direction) return false;
  const h4Bars = ep.bars.filter((x) => x.tf === "4h" && x.t <= b.t).sort((a, d) => a.t - d.t);
  if (h4Bars.length) {
    const vr = priorVolumeRatio(h4Bars, h4Bars.length - 1);
    if (vr != null && vr < VOL_4H_DEAD) return false;
  }
  return true;
}

function baselineSlot(ep: ShadowEpisode): number | null {
  const entries = ep.events.filter((e) => e.toState === "entry").sort((a, b) => a.slot - b.slot);
  return entries[0]?.slot ?? null;
}

function candidateForVariant(ep: ShadowEpisode, variant: ShadowCandidateReason): ShadowCandidate | null {
  const c = ep.case;
  const features = toShadowFeatures(c);
  const bars15 = ep.bars.filter((b) => b.tf === "15m" && b.t >= c.openedSlot).sort((a, b) => a.t - b.t);
  if (!bars15.length) return null;

  if (variant === "BASELINE_V1") {
    const slot = baselineSlot(ep);
    if (slot == null) return null;
    const b = bars15.find((x) => x.t + STEP_15M === slot);
    if (!b) return null;
    const idx = bars15.indexOf(b);
    const vr = priorVolumeRatio(bars15, idx);
    const fa = failAccept(b, c);
    const rj = reject(b, c);
    return {
      episodeId: c.episodeId,
      variant,
      decisionSlot: slot,
      decisionBarTime: b.t,
      trigger: fa ? "fail_accept" : rj ? "reject" : "none",
      triggerVolumeRatio: vr,
      triggerVolumeAvailable: vr != null,
      features,
    };
  }

  let armed = c.openedState === "pending" || c.openedState === "entry";
  for (let i = 0; i < bars15.length; i += 1) {
    const b = bars15[i]!;
    if (!armed) {
      if (c.direction === "sell" && b.c < c.zoneLow) armed = true;
      if (c.direction === "buy" && b.c > c.zoneHigh) armed = true;
      continue;
    }

    const fa = failAccept(b, c);
    const rj = reject(b, c);
    const rt = overlaps(b, c.zoneLow, c.zoneHigh);
    const vr = priorVolumeRatio(bars15, i);
    const exact = fa || rj;
    const useTrigger =
      variant === "TRIGGER_RELAXED" || variant === "VOLUME_AND_TRIGGER_RELAXED" ? rt : exact;
    const useVolume =
      variant === "VOLUME_RELAXED" || variant === "TRIGGER_RELAXED"
        ? true
        : vr != null && vr >= VOL_TRIGGER && vr >= VOL_DEAD;
    if (!useTrigger || !useVolume || !nonRelaxedGatesPass(ep, bars15, i)) continue;
    return {
      episodeId: c.episodeId,
      variant,
      decisionSlot: b.t + STEP_15M,
      decisionBarTime: b.t,
      trigger: fa ? "fail_accept" : rj ? "reject" : "retest",
      triggerVolumeRatio: vr,
      triggerVolumeAvailable: vr != null,
      features,
    };
  }
  return null;
}

function resolveShadowOutcome(candidate: ShadowCandidate, ep: ShadowEpisode): ShadowCandidateResult {
  const c = ep.case;
  const bars = ep.bars
    .filter((b) => b.tf === "15m" && b.t >= candidate.decisionSlot)
    .sort((a, b) => a.t - b.t);
  const entry = c.entry;
  const risk = Math.abs(entry - c.sl);
  let first: "sl" | "tp1" | "tp2" | null = null;
  let at: number | null = null;
  for (const b of bars) {
    const hitSl = c.direction === "sell" ? b.h >= c.sl : b.l <= c.sl;
    const hitTp1 = c.direction === "sell" ? b.l <= c.tp1 : b.h >= c.tp1;
    const hitTp2 = c.tp2 != null && (c.direction === "sell" ? b.l <= c.tp2 : b.h >= c.tp2);
    if (hitSl) { first = "sl"; at = b.t; break; }
    if (hitTp1) { first = "tp1"; at = b.t; break; }
    if (hitTp2) { first = "tp2"; at = b.t; break; }
  }
  const complete = bars.length > 0 || c.closedAtMs != null;
  if (first) {
    const reward = first === "tp2" && c.tp2 != null ? Math.abs(c.tp2 - entry) : Math.abs(c.tp1 - entry);
    return { ...candidate, outcome: first, firstTouchAtSec: at, rrAtOutcome: risk > 0 ? reward / risk : null, dataComplete: complete };
  }
  if (c.closedAtMs != null) return { ...candidate, outcome: "expired", firstTouchAtSec: null, rrAtOutcome: 0, dataComplete: complete };
  return { ...candidate, outcome: "pending", firstTouchAtSec: null, rrAtOutcome: null, dataComplete: false };
}

export function replayCandidates(episodes: readonly ShadowEpisode[]): ShadowCandidateResult[] {
  const out: ShadowCandidateResult[] = [];
  for (const ep of episodes) {
    for (const variant of SHADOW_VARIANTS) {
      const candidate = candidateForVariant(ep, variant);
      if (!candidate) continue;
      out.push(resolveShadowOutcome(candidate, ep));
    }
  }
  return out.sort((a, b) => a.decisionSlot - b.decisionSlot || a.episodeId.localeCompare(b.episodeId) || a.variant.localeCompare(b.variant));
}

function breakdown(key: string, rows: readonly ShadowCandidateResult[]): ShadowBreakdown {
  const tp1 = rows.filter((r) => r.outcome === "tp1").length;
  const tp2 = rows.filter((r) => r.outcome === "tp2").length;
  const sl = rows.filter((r) => r.outcome === "sl").length;
  const expired = rows.filter((r) => r.outcome === "expired").length;
  const decided = tp1 + tp2 + sl;
  return {
    key,
    n: rows.length,
    tp1,
    tp2,
    sl,
    expired,
    success: wilson(tp1 + tp2, decided),
    falsePositives: sl,
  };
}

function by(rows: readonly ShadowCandidateResult[], value: (r: ShadowCandidateResult) => string): ShadowBreakdown[] {
  const keys = [...new Set(rows.map(value))].sort();
  return keys.map((k) => breakdown(k, rows.filter((r) => value(r) === k)));
}

function volumeBucket(r: ShadowCandidateResult): string {
  if (r.triggerVolumeRatio == null) return "unknown";
  if (r.triggerVolumeRatio < 0.3) return "<0.3";
  if (r.triggerVolumeRatio < 1) return "0.3-<1";
  if (r.triggerVolumeRatio < 1.5) return "1-<1.5";
  if (r.triggerVolumeRatio < 2) return "1.5-<2";
  return ">=2";
}

function triggerBucket(r: ShadowCandidateResult): string {
  return r.trigger === "retest" ? "retest-only" : r.trigger;
}

function variantReport(
  variant: ShadowCandidateReason,
  rows: readonly ShadowCandidateResult[],
  episodes: readonly ShadowEpisode[],
  baselineIds: ReadonlySet<string>,
  trainCut: number,
): ShadowVariantReport {
  const vr = rows.filter((r) => r.variant === variant);
  const tp1 = vr.filter((r) => r.outcome === "tp1").length;
  const tp2 = vr.filter((r) => r.outcome === "tp2").length;
  const sl = vr.filter((r) => r.outcome === "sl").length;
  const expired = vr.filter((r) => r.outcome === "expired").length;
  const decided = tp1 + tp2 + sl;
  const rr = vr.map((r) => r.features.plannedRr).filter(finite);
  const outcomeRr = vr.map((r) => r.rrAtOutcome).filter(finite);
  const train = breakdown("TRAIN", vr.filter((r) => r.decisionSlot <= trainCut));
  const test = breakdown("TEST", vr.filter((r) => r.decisionSlot > trainCut));
  const additional = vr.filter((r) => !baselineIds.has(r.episodeId)).length;
  const observed = new Map(episodes.map((e) => [e.case.episodeId, e.observedOutcome ?? null]));
  const comparable = vr.filter((r) => observed.get(r.episodeId) != null);
  const agreements = comparable.filter((r) => observed.get(r.episodeId) === r.outcome);
  return {
    variant,
    candidates: vr.length,
    entries: vr.length,
    additionalOpportunities: variant === "BASELINE_V1" ? 0 : additional,
    tp1,
    tp2,
    sl,
    expired,
    decided,
    success: wilson(tp1 + tp2, decided),
    meanPlannedRr: mean(rr),
    meanOutcomeRr: mean(outcomeRr),
    falsePositives: sl,
    byAsset: by(vr, (r) => r.features.assetId),
    byDirection: by(vr, (r) => r.features.direction),
    bySession: by(vr, (r) => r.features.session),
    byQuality: by(vr, (r) => r.features.quality ?? "unknown"),
    byKind: by(vr, (r) => r.features.kind),
    byVolume: by(vr, volumeBucket),
    byTrigger: by(vr, triggerBucket),
    train,
    test,
    storedOutcomeAgreement: comparable.length ? agreements.length / comparable.length : null,
  };
}

export interface ShadowReplayConfig {
  trainFraction?: number;
}

export function buildShadowReplayReport(
  episodes: readonly ShadowEpisode[],
  config: ShadowReplayConfig = {},
): ShadowReplayReport {
  const results = replayCandidates(episodes);
  const ordered = [...episodes].sort((a, b) => a.case.openedAtMs - b.case.openedAtMs);
  const fraction = Math.min(0.99, Math.max(0.01, config.trainFraction ?? 0.7));
  const cutIndex = Math.floor(ordered.length * fraction);
  const trainCut = ordered[Math.max(0, cutIndex - 1)]?.case.openedAtMs ?? Number.NEGATIVE_INFINITY;
  const baselineIds = new Set(results.filter((r) => r.variant === "BASELINE_V1").map((r) => r.episodeId));
  const limitations: string[] = [];
  if (!episodes.length) limitations.push("No hay episodios disponibles.");
  if (episodes.some((e) => !e.bars.some((b) => b.tf === "15m"))) {
    limitations.push("Hay episodios sin cinta 15M; no pueden producir un candidato Shadow.");
  }
  if (episodes.some((e) => e.bars.some((b) => !Number.isFinite(b.t)))) {
    limitations.push("Hay timestamps no finitos en la cinta.");
  }
  limitations.push("El universo de Shadow está condicionado a oportunidades V1 persistidas; no inventa mapas que V1 nunca creó.");
  limitations.push("Noticias y mercado cerrado se usan desde la fotografía histórica almacenada; eventos externos no persistidos no pueden reconstruirse.");
  limitations.push("Las hipótesis son reglas fijas: TRAIN no selecciona umbrales y TEST nunca alimenta la generación de candidatos.");
  return {
    episodesAnalyzed: episodes.length,
    episodesWith15mTape: episodes.filter((e) => e.bars.some((b) => b.tf === "15m")).length,
    episodesWithGaps: episodes.filter((e) => {
      const byTf = new Map<string, number[]>();
      for (const b of e.bars) byTf.set(b.tf, [...(byTf.get(b.tf) ?? []), b.t]);
      return [...byTf.entries()].some(([tf, ts]) => {
        const step = tf === "15m" ? STEP_15M : tf === "1h" ? STEP_1H : STEP_4H;
        const sorted = [...ts].sort((a, b) => a - b);
        return sorted.some((t, i) => i > 0 && t - sorted[i - 1]! > step);
      });
    }).length,
    variants: SHADOW_VARIANTS.map((v) => variantReport(v, results, episodes, baselineIds, trainCut)),
    limitations,
  };
}

/** Pure candidate gate exposed for unit tests. It never accepts outcome data. */
export function shadowCandidateForTest(ep: ShadowEpisode, variant: ShadowCandidateReason): ShadowCandidate | null {
  return candidateForVariant(ep, variant);
}

/** Deterministic outcome evaluator exposed separately so tests can prove label separation. */
export function shadowOutcomeForTest(candidate: ShadowCandidate, ep: ShadowEpisode): ShadowCandidateResult {
  return resolveShadowOutcome(candidate, ep);
}

export const SHADOW_REPLAY_PLAN = Object.freeze({
  variants: SHADOW_VARIANTS,
  outcomeBlind: true as const,
  liveSignal: false as const,
  modifiesV1: false as const,
});
