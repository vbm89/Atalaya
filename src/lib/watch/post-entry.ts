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
