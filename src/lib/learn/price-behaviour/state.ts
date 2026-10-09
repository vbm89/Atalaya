import { median } from "./candle.ts";
import { PARAMS } from "./params.ts";
import type { Bar, ContextView, EventKind, MarketState, StructureView } from "./types.ts";

function ranges(bars: readonly Bar[], i: number, n: number): number[] {
  const out: number[] = [];
  for (let k = Math.max(0, i - n + 1); k <= i; k++) out.push(bars[k]!.h - bars[k]!.l);
  return out;
}

/**
 * El estado no sale de un indicador. Hace falta que varias lecturas coincidan:
 * swings, pendiente, posición respecto a la media y régimen de rango.
 */
export function marketStateAt(
  bars: readonly Bar[],
  i: number,
  structure: StructureView,
  ctx: ContextView,
  eventNames: readonly EventKind[],
): MarketState {
  const atr = ctx.atr;
  const bar = bars[i]!;
  const evidence: string[] = [];
  if (structure.hh && structure.hl) evidence.push("HH/HL structure");
  if (structure.lh && structure.ll) evidence.push("LH/LL structure");
  const slope =
    atr != null && atr > 0 && i >= PARAMS.slopeBars ? (bar.c - bars[i - PARAMS.slopeBars]!.c) / atr : 0;
  if (slope > PARAMS.slopeMin) evidence.push("positive slope");
  if (slope < -PARAMS.slopeMin) evidence.push("negative slope");
  if (ctx.ema != null && bar.c > ctx.ema) evidence.push("price above mean");
  if (ctx.ema != null && bar.c < ctx.ema) evidence.push("price below mean");

  const recent = ranges(bars, i, PARAMS.compressionBars);
  const med = median(recent);
  const compressed = atr != null && med != null && med < PARAMS.compressionAtrFrac * atr;
  const expanded = atr != null && atr > 0 && bar.h - bar.l >= PARAMS.expansionRangeAtr * atr;
  if (compressed) evidence.push("compression");
  if (expanded) evidence.push("expansion");

  const sweepAgainstUp = eventNames.includes("SWEEP_HIGH") || eventNames.includes("FAILED_BREAKOUT_UP");
  const sweepAgainstDown = eventNames.includes("SWEEP_LOW") || eventNames.includes("FAILED_BREAKOUT_DOWN");
  const upStructure = structure.hh && structure.hl;
  const downStructure = structure.lh && structure.ll;
  let state: MarketState["state"] = "UNCLEAR";
  if ((upStructure && sweepAgainstUp) || (downStructure && sweepAgainstDown)) {
    state = "REVERSAL_ATTEMPT";
    evidence.push("reversal attempt against prior swings");
  } else if (upStructure && !structure.bosDown) {
    state = "TREND_UP";
    if (slope < -PARAMS.slopeMin) evidence.push("pullback inside HH/HL");
  } else if (downStructure && !structure.bosUp) {
    state = "TREND_DOWN";
    if (slope > PARAMS.slopeMin) evidence.push("pullback inside LH/LL");
  } else if (compressed && !expanded) {
    state = "COMPRESSION";
  } else if (expanded && !upStructure && !downStructure) {
    state = "EXPANSION";
  } else if (
    structure.rangeHigh != null &&
    structure.rangeLow != null &&
    bar.c <= structure.rangeHigh &&
    bar.c >= structure.rangeLow &&
    ctx.ema != null &&
    atr != null &&
    Math.abs(bar.c - ctx.ema) <= 0.6 * atr
  ) {
    state = "RANGE";
    evidence.push("contained inside recent range");
  }

  const unique = [...new Set(evidence)];
  const confidence = state === "UNCLEAR" ? Math.min(0.4, unique.length / 8) : Math.min(1, unique.length / 5);
  return { state, confidence, evidence: unique };
}
