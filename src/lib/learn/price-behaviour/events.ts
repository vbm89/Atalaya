import { candleAt } from "./candle.ts";
import { PARAMS } from "./params.ts";
import type { Bar, ContextView, EventKind, PriceEvent, StructureView } from "./types.ts";

function push(
  out: PriceEvent[],
  event: EventKind,
  price: number,
  level: number | null,
  evidence: string[],
  confidence: number,
) {
  out.push({ event, confidence, price, level, evidence });
}

function brokeOut(bars: readonly Bar[], j: number): { dir: "UP" | "DOWN"; level: number } | null {
  if (j < PARAMS.rangeLookback) return null;
  let high = -Infinity;
  let low = Infinity;
  for (let k = j - PARAMS.rangeLookback; k < j; k++) {
    high = Math.max(high, bars[k]!.h);
    low = Math.min(low, bars[k]!.l);
  }
  const bar = bars[j]!;
  const range = bar.h - bar.l;
  if (!(range > 0)) return null;
  const loc = (bar.c - bar.l) / range;
  const upper = (bar.h - Math.max(bar.o, bar.c)) / range;
  const lower = (Math.min(bar.o, bar.c) - bar.l) / range;
  if (bar.c > high && loc >= 0.6 && upper < PARAMS.rejectionMaxOppositeWick) return { dir: "UP", level: high };
  if (bar.c < low && loc <= 0.4 && lower < PARAMS.rejectionMaxOppositeWick) return { dir: "DOWN", level: low };
  return null;
}

/**
 * Eventos de la vela cerrada i contra niveles calculados solo con velas anteriores.
 * Pueden convivir varios. NO_EVENT solo si no hay ninguno.
 */
export function eventsAt(bars: readonly Bar[], i: number, structure: StructureView, ctx: ContextView): PriceEvent[] {
  const bar = bars[i]!;
  const atr = ctx.atr;
  const candle = candleAt(bars, i, atr);
  const out: PriceEvent[] = [];
  if (!candle || atr == null || atr <= 0 || candle.range <= 0) {
    return [{ event: "NO_EVENT", confidence: 0, price: bar.c, level: null, evidence: ["vela sin rango útil"] }];
  }

  const rangeHigh = structure.rangeHigh;
  const rangeLow = structure.rangeLow;
  const recentHigh = structure.recentHigh;
  const recentLow = structure.recentLow;

  if (
    rangeHigh != null &&
    bar.c > rangeHigh + PARAMS.breakoutBufferAtr * atr &&
    candle.closeLocation >= 0.6 &&
    candle.upperWick / candle.range < PARAMS.rejectionMaxOppositeWick
  ) {
    push(out, "BREAKOUT_UP", bar.c, rangeHigh, ["cierre fuera del rango", "sin mecha de rechazo inmediata"], 0.8);
  }
  if (
    rangeLow != null &&
    bar.c < rangeLow - PARAMS.breakoutBufferAtr * atr &&
    candle.closeLocation <= 0.4 &&
    candle.lowerWick / candle.range < PARAMS.rejectionMaxOppositeWick
  ) {
    push(out, "BREAKOUT_DOWN", bar.c, rangeLow, ["cierre fuera del rango", "sin mecha de rechazo inmediata"], 0.8);
  }

  const sweepHighLevel = [recentHigh, ctx.sessionHigh].filter((n): n is number => n != null).sort((a, b) => a - b);
  for (const level of sweepHighLevel) {
    if (bar.h > level && bar.c < level) {
      push(out, "SWEEP_HIGH", bar.h, level, ["mecha por encima del extremo", "cierre de vuelta dentro"], 0.85);
      break;
    }
  }
  const sweepLowLevel = [recentLow, ctx.sessionLow].filter((n): n is number => n != null).sort((a, b) => b - a);
  for (const level of sweepLowLevel) {
    if (bar.l < level && bar.c > level) {
      push(out, "SWEEP_LOW", bar.l, level, ["mecha por debajo del extremo", "cierre de vuelta dentro"], 0.85);
      break;
    }
  }

  const prev = i > 0 ? bars[i - 1]! : null;
  const reclaimUp = structure.lastLow?.price ?? rangeLow;
  const reclaimDown = structure.lastHigh?.price ?? rangeHigh;
  if (prev && reclaimUp != null && prev.c < reclaimUp && bar.c > reclaimUp) {
    push(out, "RECLAIM_UP", bar.c, reclaimUp, ["cierre previo perdido", "cierre actual recupera el nivel"], 0.75);
  }
  if (prev && reclaimDown != null && prev.c > reclaimDown && bar.c < reclaimDown) {
    push(out, "RECLAIM_DOWN", bar.c, reclaimDown, ["cierre previo por encima", "cierre actual pierde el nivel"], 0.75);
  }

  const nearHigh =
    recentHigh != null && atr > 0 && Math.abs(bar.h - recentHigh) <= 0.35 * atr;
  const nearLow = recentLow != null && atr > 0 && Math.abs(bar.l - recentLow) <= 0.35 * atr;
  if (candle.upperWick / candle.range >= PARAMS.rejectionWickFrac && candle.closeLocation <= 0.55 && (nearHigh || (rangeHigh != null && bar.h >= rangeHigh))) {
    push(out, "REJECTION_HIGH", bar.h, recentHigh ?? rangeHigh, ["mecha superior dominante", "cierre lejos del máximo"], 0.7);
  }
  if (candle.lowerWick / candle.range >= PARAMS.rejectionWickFrac && candle.closeLocation >= 0.45 && (nearLow || (rangeLow != null && bar.l <= rangeLow))) {
    push(out, "REJECTION_LOW", bar.l, recentLow ?? rangeLow, ["mecha inferior dominante", "cierre lejos del mínimo"], 0.7);
  }

  if (
    candle.rangeAtr != null &&
    candle.rangeAtr >= PARAMS.displacementRangeAtr &&
    candle.bodyFrac >= PARAMS.displacementBodyFrac &&
    candle.closeLocation >= PARAMS.displacementCloseLoc &&
    bar.c > bar.o
  ) {
    push(out, "DISPLACEMENT_UP", bar.c, null, ["rango amplio frente al ATR", "cuerpo y cierre alcistas"], 0.8);
  }
  if (
    candle.rangeAtr != null &&
    candle.rangeAtr >= PARAMS.displacementRangeAtr &&
    candle.bodyFrac >= PARAMS.displacementBodyFrac &&
    candle.closeLocation <= 1 - PARAMS.displacementCloseLoc &&
    bar.c < bar.o
  ) {
    push(out, "DISPLACEMENT_DOWN", bar.c, null, ["rango amplio frente al ATR", "cuerpo y cierre bajistas"], 0.8);
  }

  const upLeg = structure.hh && structure.hl && structure.lastHigh != null && structure.lastLow != null;
  const downLeg = structure.lh && structure.ll && structure.lastHigh != null && structure.lastLow != null;
  if (upLeg && bar.c <= structure.lastHigh!.price - PARAMS.pullbackMinAtr * atr && bar.c >= structure.lastLow!.price) {
    push(out, "PULLBACK", bar.c, structure.lastLow!.price, ["retroceso desde el último máximo", "mínimo ascendente aún vigente"], 0.7);
  }
  if (
    downLeg &&
    structure.lastLow != null &&
    bar.c >= structure.lastLow.price + PARAMS.pullbackMinAtr * atr &&
    bar.c <= structure.lastHigh!.price
  ) {
    push(out, "PULLBACK", bar.c, structure.lastHigh!.price, ["retroceso desde el último mínimo", "máximo descendente aún vigente"], 0.7);
  }

  if (out.some((e) => e.event === "PULLBACK") && out.some((e) => e.event === "REJECTION_LOW" || e.event === "REJECTION_HIGH" || e.event === "RECLAIM_UP" || e.event === "RECLAIM_DOWN" || e.event === "DISPLACEMENT_UP" || e.event === "DISPLACEMENT_DOWN")) {
    push(out, "PULLBACK_COMPLETE", bar.c, null, ["el retroceso ya tiene reacción"], 0.75);
  }

  if (compressedPrefix(bars, i, atr)) push(out, "COMPRESSION", bar.c, null, ["rangos recientes por debajo del ATR"], 0.7);
  if (candle.rangeAtr != null && candle.rangeAtr >= PARAMS.expansionRangeAtr) {
    push(out, "EXPANSION", bar.c, null, ["la vela expande el rango respecto al ATR"], 0.7);
  }

  let prior: { dir: "UP" | "DOWN"; level: number } | null = null;
  const start = Math.max(PARAMS.rangeLookback, i - PARAMS.eventLookback);
  for (let j = start; j < i; j++) {
    const found = brokeOut(bars, j);
    if (found) prior = found;
  }
  const dispDown = out.some((e) => e.event === "DISPLACEMENT_DOWN");
  const dispUp = out.some((e) => e.event === "DISPLACEMENT_UP");
  if (prior?.dir === "UP" && bar.c < prior.level && (dispDown || candle.closeLocation < 0.45)) {
    push(out, "FAILED_BREAKOUT_UP", bar.c, prior.level, ["hubo cierre fuera del rango", "el precio ha vuelto dentro"], 0.8);
  }
  if (prior?.dir === "DOWN" && bar.c > prior.level && (dispUp || candle.closeLocation > 0.55)) {
    push(out, "FAILED_BREAKOUT_DOWN", bar.c, prior.level, ["hubo cierre fuera del rango", "el precio ha vuelto dentro"], 0.8);
  }

  if (!out.length) push(out, "NO_EVENT", bar.c, null, ["sin evento de precio en la vela cerrada"], 0.2);
  return out;
}

function compressedPrefix(bars: readonly Bar[], i: number, atr: number): boolean {
  const vals: number[] = [];
  for (let k = Math.max(0, i - PARAMS.compressionBars + 1); k <= i; k++) vals.push(bars[k]!.h - bars[k]!.l);
  vals.sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)] ?? 0;
  return med < PARAMS.compressionAtrFrac * atr;
}

export function hasEvent(events: readonly PriceEvent[], kind: EventKind): boolean {
  return events.some((e) => e.event === kind);
}

export function primaryEvent(events: readonly PriceEvent[]): EventKind {
  const order: EventKind[] = [
    "FAILED_BREAKOUT_UP",
    "FAILED_BREAKOUT_DOWN",
    "SWEEP_LOW",
    "SWEEP_HIGH",
    "RECLAIM_UP",
    "RECLAIM_DOWN",
    "BREAKOUT_UP",
    "BREAKOUT_DOWN",
    "REJECTION_LOW",
    "REJECTION_HIGH",
    "DISPLACEMENT_UP",
    "DISPLACEMENT_DOWN",
    "PULLBACK_COMPLETE",
    "PULLBACK",
    "EXPANSION",
    "COMPRESSION",
    "NO_EVENT",
  ];
  for (const kind of order) if (hasEvent(events, kind)) return kind;
  return "NO_EVENT";
}
