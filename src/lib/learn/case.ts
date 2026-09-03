import type { AssetId, SetupState } from "../trading/types";
import type { EpisodeDraft } from "../watch/episode";
import { freezeField, type EpisodeFreeze } from "../watch/freeze";
import type { HistoryRow } from "../watch/store";
import { entryPrice } from "../watch/history-view";

/**
 * P5.2 persistence: DERIVE from signal_episodes + episode_freeze + outcomes.
 * Freeze JSON on the episode is the photograph (enriched at capture).
 * No learning_cases table — avoids a second source of truth that could drift.
 */

export type ExclusionReason =
  | "OUTCOME_PENDING"
  | "DATA_INVALID"
  | "FREEZE_MISSING"
  | "LEVELS_INCOHERENT"
  | "TIMESTAMP_INVALID"
  | "DUPLICATE";

export const OUTCOME_LABELS = ["tp1", "tp2", "sl", "expired", "pending", "none"] as const;

export interface LearningCase {
  episodeId: string;
  assetId: AssetId;
  direction: "buy" | "sell";
  kind: string;
  timeframe: "15m";
  openedAtMs: number;
  openedSlot: number;
  closedAtMs: number | null;
  openedState: SetupState;
  currentState: SetupState;
  waitReason: string | null;
  missingForEntry: string | null;
  bias4hLabel: string | null;
  warnings: string[] | null;
  qualityPhase: string | null;
  volumeRatio15: number | null;
  volumeAvailable15: boolean | null;
  volumeRatio4h: number | null;
  volumeAvailable4h: boolean | null;
  highImpact: boolean | null;
  underlyingClosed: boolean | null;
  dataStatus: string | null;
  zoneLow: number;
  zoneHigh: number;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  invalidation: number | null;
  riskReward: number | null;
  quality: string | null;
  basis: number | null;
  outcome: string | null;
  firstTouch: string | null;
  firstTouchAtMs: number | null;
  mfe: number | null;
  mae: number | null;
  durationMs: number | null;
  trainable: boolean;
  exclusionReason: ExclusionReason | null;
  complete: boolean;
  /** production = historial real. test = fixtures. Ausente se trata como production. */
  origin?: "production" | "test";
}

const INVALID_DATA = new Set(["error", "insufficient"]);

function freezeOf(ep: EpisodeDraft): EpisodeFreeze | null {
  return ep.freeze ?? null;
}

export function levelsIncoherent(ep: EpisodeDraft): boolean {
  if (!Number.isFinite(ep.zoneLow) || !Number.isFinite(ep.zoneHigh)) return true;
  if (!(ep.zoneLow < ep.zoneHigh)) return true;
  if (!Number.isFinite(ep.sl) || !Number.isFinite(ep.tp1)) return true;
  const entry = entryPrice(ep.direction, ep.zoneLow, ep.zoneHigh);
  if (ep.direction === "sell") {
    if (!(ep.sl > ep.zoneHigh)) return true;
    if (!(ep.tp1 < entry)) return true;
  } else {
    if (!(ep.sl < ep.zoneLow)) return true;
    if (!(ep.tp1 > entry)) return true;
  }
  if (ep.tp2 != null && !Number.isFinite(ep.tp2)) return true;
  return false;
}

export function timestampsInvalid(row: HistoryRow): boolean {
  const ep = row.episode;
  if (!Number.isFinite(ep.openedAtMs) || ep.openedAtMs <= 0) return true;
  if (ep.closedAtMs != null && ep.closedAtMs < ep.openedAtMs) return true;
  if (row.firstTouchAtMs == null) return false;
  if (!Number.isFinite(row.firstTouchAtMs) || row.firstTouchAtMs <= 0) return true;
  if (!Number.isFinite(ep.openedSlot) || ep.openedSlot <= 0) return true;
  const touchSlot = Math.floor(row.firstTouchAtMs / 1000);
  return touchSlot < ep.openedSlot;
}

export function dataInvalid(freeze: EpisodeFreeze | null): boolean {
  if (!freeze) return false;
  const st = freeze.dataStatus;
  return st != null && INVALID_DATA.has(st);
}

export function outcomePending(outcome: string | null): boolean {
  return outcome == null || outcome === "pending" || outcome === "none";
}

export function exclusionOf(row: HistoryRow): ExclusionReason | null {
  const ep = row.episode;
  if (!ep.freeze) return "FREEZE_MISSING";
  if (dataInvalid(ep.freeze)) return "DATA_INVALID";
  if (levelsIncoherent(ep)) return "LEVELS_INCOHERENT";
  if (timestampsInvalid(row)) return "TIMESTAMP_INVALID";
  if (outcomePending(row.outcome)) return "OUTCOME_PENDING";
  return null;
}

function durationMs(row: HistoryRow): number | null {
  const start = row.episode.openedAtMs;
  const end = row.episode.closedAtMs ?? row.firstTouchAtMs;
  if (end == null || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function completePhoto(f: EpisodeFreeze | null): boolean {
  if (!f) return false;
  return (
    freezeField(f.bias4hLabel) != null &&
    freezeField(f.setupState) != null &&
    f.capturedAtMs > 0
  );
}

export function learningCaseFromHistory(row: HistoryRow): LearningCase {
  const ep = row.episode;
  const f = freezeOf(ep);
  const exclusion = exclusionOf(row);
  const entry = entryPrice(ep.direction, ep.zoneLow, ep.zoneHigh);
  return {
    episodeId: ep.episodeId,
    assetId: ep.assetId,
    direction: ep.direction,
    kind: ep.kind,
    timeframe: "15m",
    openedAtMs: ep.openedAtMs,
    openedSlot: ep.openedSlot,
    closedAtMs: ep.closedAtMs,
    openedState: ep.openedState,
    currentState: ep.currentState,
    waitReason: freezeField(f?.waitReason),
    missingForEntry: freezeField(f?.missingForEntry),
    bias4hLabel: freezeField(f?.bias4hLabel),
    warnings: f?.warnings === undefined ? null : f.warnings,
    qualityPhase: freezeField(f?.qualityPhase),
    volumeRatio15: freezeField(f?.volumeRatio15),
    volumeAvailable15: freezeField(f?.volumeAvailable15),
    volumeRatio4h: freezeField(f?.volumeRatio4h),
    volumeAvailable4h: freezeField(f?.volumeAvailable4h),
    highImpact: f ? f.highImpact : null,
    underlyingClosed: f ? f.underlyingClosed : null,
    dataStatus: freezeField(f?.dataStatus),
    zoneLow: ep.zoneLow,
    zoneHigh: ep.zoneHigh,
    entry,
    sl: ep.sl,
    tp1: ep.tp1,
    tp2: ep.tp2,
    invalidation: freezeField(f?.invalidation),
    riskReward: freezeField(f?.riskReward),
    quality: freezeField(f?.quality),
    basis: freezeField(f?.basis),
    outcome: row.outcome,
    firstTouch: row.firstTouch,
    firstTouchAtMs: row.firstTouchAtMs,
    mfe: row.mfe,
    mae: row.mae,
    durationMs: durationMs(row),
    trainable: exclusion == null,
    exclusionReason: exclusion,
    complete: completePhoto(f),
    origin: "production",
  };
}

/** First row per episodeId wins. Duplicates are dropped, not rewritten. */
export function learningCasesFromHistory(rows: HistoryRow[]): LearningCase[] {
  const seen = new Set<string>();
  const out: LearningCase[] = [];
  for (const row of rows) {
    const id = row.episode.episodeId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(learningCaseFromHistory(row));
  }
  return out;
}
