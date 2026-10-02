import { PARAMS } from "./params.ts";
import type { Bar, ContextView, MarketState, PriceEvent, SetupHit, StructureView } from "./types.ts";
import { hasEvent } from "./events.ts";

function hit(
  id: SetupHit["id"],
  direction: SetupHit["direction"],
  evidence: Record<string, boolean>,
  critical: string[],
  defended: number | null,
): SetupHit {
  const missing = critical.filter((key) => !evidence[key]);
  return { id, direction, complete: missing.length === 0 && defended != null, evidence, missing, defended };
}

function reactionLow(events: readonly PriceEvent[]): boolean {
  return hasEvent(events, "REJECTION_LOW") || hasEvent(events, "RECLAIM_UP") || hasEvent(events, "SWEEP_LOW");
}

function reactionHigh(events: readonly PriceEvent[]): boolean {
  return hasEvent(events, "REJECTION_HIGH") || hasEvent(events, "RECLAIM_DOWN") || hasEvent(events, "SWEEP_HIGH");
}

function near(distanceAtr: number | null, limit = PARAMS.locationAtr): boolean {
  return distanceAtr != null && Math.abs(distanceAtr) <= limit;
}

/**
 * Cinco setups. Una pieza crítica ausente deja el setup incompleto:
 * el motor no convierte un evento suelto en COMPRA o VENTA.
 * Prioridad posterior: C, D, A, B, E.
 */
export function setupsAt(
  bars: readonly Bar[],
  i: number,
  state: MarketState,
  structure: StructureView,
  events: readonly PriceEvent[],
  ctx: ContextView,
): SetupHit[] {
  const bar = bars[i]!;
  const atr = ctx.atr ?? 0;
  const out: SetupHit[] = [];
  const dispUp = hasEvent(events, "DISPLACEMENT_UP");
  const dispDown = hasEvent(events, "DISPLACEMENT_DOWN");
  const pullback = hasEvent(events, "PULLBACK") || hasEvent(events, "PULLBACK_COMPLETE");
  const rangeOrCompression = state.state === "RANGE" || state.state === "COMPRESSION" || hasEvent(events, "COMPRESSION");
  const priorCompressed = priorCompression(bars, i, atr);

  const strongContinuationLong =
    state.state === "TREND_UP" &&
    structure.hh &&
    structure.hl &&
    !structure.bosDown &&
    dispUp &&
    structure.lastHigh != null &&
    bar.c > structure.lastHigh.price;

  const strongContinuationShort =
    state.state === "TREND_DOWN" &&
    structure.lh &&
    structure.ll &&
    !structure.bosUp &&
    dispDown &&
    structure.lastLow != null &&
    bar.c < structure.lastLow.price;

  const longLocation =
    near(ctx.distEmaAtr) ||
    (structure.lastLow != null && atr > 0 && Math.abs(bar.c - structure.lastLow.price) / atr <= PARAMS.locationAtr) ||
    (structure.rangeLow != null && bar.l <= structure.rangeLow && atr > 0 && (bar.c - bar.l) / atr <= PARAMS.locationAtr);
  const shortLocation =
    near(ctx.distEmaAtr) ||
    (structure.lastHigh != null && atr > 0 && Math.abs(bar.c - structure.lastHigh.price) / atr <= PARAMS.locationAtr) ||
    (structure.rangeHigh != null && bar.h >= structure.rangeHigh && atr > 0 && (bar.h - bar.c) / atr <= PARAMS.locationAtr);

  out.push(
    hit(
      "TREND_PULLBACK",
      "LONG",
      {
        trend: state.state === "TREND_UP",
        structure: structure.hh && structure.hl && !structure.bosDown,
        pullback: pullback || strongContinuationLong,
        reclaim: reactionLow(events) || strongContinuationLong,
        displacement: dispUp,
        location: longLocation || strongContinuationLong,
      },
      ["trend", "structure", "pullback", "reclaim", "displacement", "location"],
      Math.min(bar.l, structure.lastLow?.price ?? bar.l),
    ),
  );
  out.push(
    hit(
      "TREND_PULLBACK",
      "SHORT",
      {
        trend: state.state === "TREND_DOWN",
        structure: structure.lh && structure.ll && !structure.bosUp,
        pullback: pullback || strongContinuationShort,
        reclaim: reactionHigh(events) || strongContinuationShort,
        displacement: dispDown,
        location: shortLocation || strongContinuationShort,
      },
      ["trend", "structure", "pullback", "reclaim", "displacement", "location"],
      Math.max(bar.h, structure.lastHigh?.price ?? bar.h),
    ),
  );

  out.push(
    hit(
      "BREAKOUT_ACCEPTANCE",
      "LONG",
      {
        trend: rangeOrCompression,
        structure: structure.rangeHigh != null && bar.c > structure.rangeHigh,
        displacement: dispUp,
        breakout: hasEvent(events, "BREAKOUT_UP"),
        noRejection: bar.h - Math.max(bar.o, bar.c) < PARAMS.rejectionMaxOppositeWick * Math.max(bar.h - bar.l, 1e-9),
      },
      ["trend", "structure", "breakout", "displacement", "noRejection"],
      structure.rangeHigh,
    ),
  );
  out.push(
    hit(
      "BREAKOUT_ACCEPTANCE",
      "SHORT",
      {
        trend: rangeOrCompression,
        structure: structure.rangeLow != null && bar.c < structure.rangeLow,
        displacement: dispDown,
        breakout: hasEvent(events, "BREAKOUT_DOWN"),
        noRejection: Math.min(bar.o, bar.c) - bar.l < PARAMS.rejectionMaxOppositeWick * Math.max(bar.h - bar.l, 1e-9),
      },
      ["trend", "structure", "breakout", "displacement", "noRejection"],
      structure.rangeLow,
    ),
  );

  const sweepLow = events.find((e) => e.event === "SWEEP_LOW");
  const sweepHigh = events.find((e) => e.event === "SWEEP_HIGH");
  out.push(
    hit(
      "SWEEP_RECLAIM",
      "LONG",
      {
        structure: sweepLow != null && bar.c > (sweepLow.level ?? bar.l),
        reclaim: bar.c > (sweepLow?.level ?? Infinity),
        displacement: dispUp,
      },
      ["structure", "reclaim", "displacement"],
      bar.l,
    ),
  );
  out.push(
    hit(
      "SWEEP_RECLAIM",
      "SHORT",
      {
        structure: sweepHigh != null && bar.c < (sweepHigh.level ?? bar.h),
        reclaim: bar.c < (sweepHigh?.level ?? -Infinity),
        displacement: dispDown,
      },
      ["structure", "reclaim", "displacement"],
      bar.h,
    ),
  );

  const failedDown = events.find((e) => e.event === "FAILED_BREAKOUT_DOWN");
  const failedUp = events.find((e) => e.event === "FAILED_BREAKOUT_UP");
  out.push(
    hit(
      "FAILED_BREAKOUT",
      "LONG",
      {
        structure: failedDown != null && structure.rangeLow != null && bar.c > (failedDown.level ?? structure.rangeLow),
        reclaim: failedDown != null,
        displacement: dispUp,
      },
      ["structure", "reclaim", "displacement"],
      bar.l,
    ),
  );
  out.push(
    hit(
      "FAILED_BREAKOUT",
      "SHORT",
      {
        structure: failedUp != null && structure.rangeHigh != null && bar.c < (failedUp.level ?? structure.rangeHigh),
        reclaim: failedUp != null,
        displacement: dispDown,
      },
      ["structure", "reclaim", "displacement"],
      bar.h,
    ),
  );

  const alignedUp = state.state === "TREND_UP" || structure.bosUp || hasEvent(events, "BREAKOUT_UP");
  const alignedDown = state.state === "TREND_DOWN" || structure.bosDown || hasEvent(events, "BREAKOUT_DOWN");
  out.push(
    hit(
      "EXPANSION_CONTINUATION",
      "LONG",
      {
        trend: priorCompressed,
        structure: alignedUp,
        displacement: dispUp || hasEvent(events, "EXPANSION"),
        location: candleCloseHigh(bar),
      },
      ["trend", "structure", "displacement", "location"],
      bar.l,
    ),
  );
  out.push(
    hit(
      "EXPANSION_CONTINUATION",
      "SHORT",
      {
        trend: priorCompressed,
        structure: alignedDown,
        displacement: dispDown || hasEvent(events, "EXPANSION"),
        location: candleCloseLow(bar),
      },
      ["trend", "structure", "displacement", "location"],
      bar.h,
    ),
  );

  return out;
}

function candleCloseHigh(bar: Bar): boolean {
  const range = bar.h - bar.l;
  return range > 0 && (bar.c - bar.l) / range >= PARAMS.closeExtreme && bar.c > bar.o;
}

function candleCloseLow(bar: Bar): boolean {
  const range = bar.h - bar.l;
  return range > 0 && (bar.c - bar.l) / range <= 1 - PARAMS.closeExtreme && bar.c < bar.o;
}

function priorCompression(bars: readonly Bar[], i: number, atr: number): boolean {
  if (!(atr > 0) || i < PARAMS.compressionBars + 1) return false;
  const vals: number[] = [];
  for (let k = i - PARAMS.compressionBars; k < i; k++) vals.push(bars[k]!.h - bars[k]!.l);
  vals.sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)] ?? atr;
  return med < PARAMS.compressionAtrFrac * atr;
}

export const SETUP_PRIORITY: SetupHit["id"][] = [
  "SWEEP_RECLAIM",
  "FAILED_BREAKOUT",
  "TREND_PULLBACK",
  "BREAKOUT_ACCEPTANCE",
  "EXPANSION_CONTINUATION",
];
