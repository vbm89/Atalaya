import type { Candle } from "../trading/types";
import type { EpisodeDraft, SignalEventDraft } from "./episode";
import { resolveOutcome, type OutcomeKind } from "./outcome";

/** Research metrics from the real V1 ENTRY event. Does not replace signal_outcomes. */
export interface PostEntryMetrics {
  entryAtMs: number;
  entrySlot: number;
  entryPrice: number;
  outcome: OutcomeKind;
  firstTouch: "sl" | "tp1" | "tp2" | null;
  firstTouchAtSec: number | null;
  mfe: number | null;
  mae: number | null;
}

export function isTerminalPostEntry(outcome: OutcomeKind | string | null | undefined): boolean {
  return outcome === "sl" || outcome === "tp1" || outcome === "tp2" || outcome === "expired";
}

export function v1EntryPrice(direction: "buy" | "sell", zoneLow: number, zoneHigh: number): number {
  return direction === "sell" ? zoneLow : zoneHigh;
}

export function computePostEntryMetrics(
  episode: Pick<EpisodeDraft, "direction" | "sl" | "tp1" | "tp2" | "zoneLow" | "zoneHigh" | "closedAtMs">,
  entry: Pick<SignalEventDraft, "atMs" | "slot">,
  candles: readonly Candle[],
): PostEntryMetrics {
  const resolved = resolveOutcome({
    direction: episode.direction,
    sl: episode.sl,
    tp1: episode.tp1,
    tp2: episode.tp2,
    zoneLow: episode.zoneLow,
    zoneHigh: episode.zoneHigh,
    openedSlot: entry.slot,
    closed: episode.closedAtMs != null,
    candles: [...candles],
  });
  return {
    entryAtMs: entry.atMs,
    entrySlot: entry.slot,
    entryPrice: v1EntryPrice(episode.direction, episode.zoneLow, episode.zoneHigh),
    outcome: resolved.outcome,
    firstTouch: resolved.firstTouch,
    firstTouchAtSec: resolved.firstTouchAtSec,
    mfe: resolved.mfe,
    mae: resolved.mae,
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: unknown): value is number {
  return finiteNumber(value) && value > 0;
}

function asOutcome(value: unknown): OutcomeKind {
  if (value === "sl" || value === "tp1" || value === "tp2" || value === "expired") return value;
  if (value === "none") return "none";
  return "pending";
}

function asTouch(value: unknown): PostEntryMetrics["firstTouch"] {
  return value === "sl" || value === "tp1" || value === "tp2" ? value : null;
}

function maxExcursion(prev: number | null, next: number | null): number | null {
  if (prev == null) return next;
  if (next == null) return prev;
  return Math.max(prev, next);
}

function causalTouch(
  entrySlot: number,
  firstTouch: PostEntryMetrics["firstTouch"],
  firstTouchAtSec: number | null,
): { firstTouch: PostEntryMetrics["firstTouch"]; firstTouchAtSec: number | null } {
  if (firstTouch == null) return { firstTouch: null, firstTouchAtSec: null };
  if (firstTouchAtSec != null && firstTouchAtSec < entrySlot) {
    return { firstTouch: null, firstTouchAtSec: null };
  }
  return { firstTouch, firstTouchAtSec };
}

/** Missing/partial JSON is not a photograph. Do not invent identity. */
export function parsePostEntry(raw: unknown): PostEntryMetrics | null {
  if (raw == null || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!finitePositive(row.entryAtMs) || !finiteNumber(row.entrySlot) || !finiteNumber(row.entryPrice)) {
    return null;
  }
  return {
    entryAtMs: row.entryAtMs,
    entrySlot: row.entrySlot,
    entryPrice: row.entryPrice,
    outcome: asOutcome(row.outcome),
    firstTouch: asTouch(row.firstTouch),
    firstTouchAtSec: finiteNumber(row.firstTouchAtSec) ? row.firstTouchAtSec : null,
    mfe: finiteNumber(row.mfe) ? row.mfe : null,
    mae: finiteNumber(row.mae) ? row.mae : null,
  };
}

/**
 * Persistence guarantee for details.postEntry. Does not change V1 outcomes.
 * Identity is write-once. Terminal outcome/firstTouch never recede. MFE/MAE
 * only rise while pending; once terminal the whole photograph is frozen.
 */
export function mergePostEntry(
  existing: PostEntryMetrics | null | undefined,
  incoming: PostEntryMetrics,
): PostEntryMetrics {
  if (!existing) {
    const touch = causalTouch(incoming.entrySlot, incoming.firstTouch, incoming.firstTouchAtSec);
    let outcome = incoming.outcome;
    if (touch.firstTouch == null && isTerminalPostEntry(outcome) && outcome !== "expired") {
      outcome = "pending";
    }
    if (touch.firstTouch && !isTerminalPostEntry(outcome)) outcome = touch.firstTouch;
    return {
      entryAtMs: incoming.entryAtMs,
      entrySlot: incoming.entrySlot,
      entryPrice: incoming.entryPrice,
      outcome,
      firstTouch: touch.firstTouch,
      firstTouchAtSec: touch.firstTouchAtSec,
      mfe: incoming.mfe,
      mae: incoming.mae,
    };
  }

  const identity = {
    entryAtMs: existing.entryAtMs,
    entrySlot: existing.entrySlot,
    entryPrice: existing.entryPrice,
  };

  if (isTerminalPostEntry(existing.outcome)) {
    return { ...existing, ...identity };
  }

  const storedTouch = causalTouch(identity.entrySlot, existing.firstTouch, existing.firstTouchAtSec);
  if (storedTouch.firstTouch) {
    return {
      ...existing,
      ...identity,
      outcome: storedTouch.firstTouch,
      firstTouch: storedTouch.firstTouch,
      firstTouchAtSec: storedTouch.firstTouchAtSec,
    };
  }

  const nextTouch = causalTouch(identity.entrySlot, incoming.firstTouch, incoming.firstTouchAtSec);
  if (nextTouch.firstTouch) {
    return {
      ...identity,
      outcome: nextTouch.firstTouch,
      firstTouch: nextTouch.firstTouch,
      firstTouchAtSec: nextTouch.firstTouchAtSec,
      mfe: maxExcursion(existing.mfe, incoming.mfe),
      mae: maxExcursion(existing.mae, incoming.mae),
    };
  }

  return {
    ...identity,
    outcome: incoming.outcome === "expired" ? "expired" : "pending",
    firstTouch: null,
    firstTouchAtSec: null,
    mfe: maxExcursion(existing.mfe, incoming.mfe),
    mae: maxExcursion(existing.mae, incoming.mae),
  };
}
