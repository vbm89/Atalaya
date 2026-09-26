/**
 * Prioridad 2. No es un setup completo y no afirma edge.
 * Solo entra si la vela cerrada ya tiene estructura, dirección, evento,
 * confirmación, ubicación y un nivel que pueda invalidar la idea.
 * No usa RSI, ni tiempo sin señal, ni un objetivo fabricado.
 */
import { PARAMS } from "./params.ts";
import type { Bar, ContextView, EventKind, MarketState, PriceEvent, SetupId, Side, StructureView } from "./types.ts";

const LONG_EVENTS: EventKind[] = [
  "FAILED_BREAKOUT_DOWN",
  "SWEEP_LOW",
  "RECLAIM_UP",
  "BREAKOUT_UP",
  "REJECTION_LOW",
  "DISPLACEMENT_UP",
];

const SHORT_EVENTS: EventKind[] = [
  "FAILED_BREAKOUT_UP",
  "SWEEP_HIGH",
  "RECLAIM_DOWN",
  "BREAKOUT_DOWN",
  "REJECTION_HIGH",
  "DISPLACEMENT_DOWN",
];

export interface PartialReading {
  direction: Side;
  setup: SetupId;
  defended: number;
  event: EventKind;
  evidence: Record<string, boolean>;
}

function firstOf(events: readonly PriceEvent[], kinds: readonly EventKind[]): PriceEvent | null {
  for (const kind of kinds) {
    const found = events.find((e) => e.event === kind);
    if (found) return found;
  }
  return null;
}

function closeLocation(bar: Bar): number {
  const range = bar.h - bar.l;
  if (!(range > 0)) return 0.5;
  return (bar.c - bar.l) / range;
}

function candleConfirms(bar: Bar, side: Side): boolean {
  const range = bar.h - bar.l;
  if (!(range > 0)) return false;
  const loc = closeLocation(bar);
  if (side === "LONG") {
    const upper = (bar.h - Math.max(bar.o, bar.c)) / range;
    return bar.c > bar.o && loc >= 0.62 && upper < 0.45;
  }
  const lower = (Math.min(bar.o, bar.c) - bar.l) / range;
  return bar.c < bar.o && loc <= 0.38 && lower < 0.45;
}

function structureOk(side: Side, event: PriceEvent, structure: StructureView, state: MarketState): boolean {
  const kind = event.event;
  if (side === "LONG" && (kind === "BREAKOUT_UP" || kind === "SWEEP_LOW" || kind === "REJECTION_LOW" || kind === "RECLAIM_UP" || kind === "FAILED_BREAKOUT_DOWN")) {
    return event.level != null && Number.isFinite(event.level);
  }
  if (side === "SHORT" && (kind === "BREAKOUT_DOWN" || kind === "SWEEP_HIGH" || kind === "REJECTION_HIGH" || kind === "RECLAIM_DOWN" || kind === "FAILED_BREAKOUT_UP")) {
    return event.level != null && Number.isFinite(event.level);
  }
  if (side === "LONG" && (kind === "DISPLACEMENT_UP" || kind === "PULLBACK_COMPLETE")) {
    return (structure.hh && structure.hl && !structure.bosDown) || state.state === "TREND_UP";
  }
  if (side === "SHORT" && (kind === "DISPLACEMENT_DOWN" || kind === "PULLBACK_COMPLETE")) {
    return (structure.lh && structure.ll && !structure.bosUp) || state.state === "TREND_DOWN";
  }
  return false;
}

function setupFor(event: EventKind, side: Side, state: MarketState): SetupId {
  if (event === "SWEEP_LOW" || event === "SWEEP_HIGH") return "SWEEP_RECLAIM";
  if (event === "FAILED_BREAKOUT_UP" || event === "FAILED_BREAKOUT_DOWN") return "FAILED_BREAKOUT";
  if (event === "BREAKOUT_UP" || event === "BREAKOUT_DOWN") return "BREAKOUT_ACCEPTANCE";
  if (event === "DISPLACEMENT_UP" || event === "DISPLACEMENT_DOWN" || event === "EXPANSION") {
    if (state.state === "TREND_UP" || state.state === "TREND_DOWN") return "TREND_PULLBACK";
    return "EXPANSION_CONTINUATION";
  }
  if (side === "LONG" || side === "SHORT") return "TREND_PULLBACK";
  return "BREAKOUT_ACCEPTANCE";
}

function defendedOf(side: Side, bar: Bar, event: PriceEvent, structure: StructureView): number | null {
  if (side === "LONG") {
    if (event.event === "BREAKOUT_UP" && event.level != null && event.level < bar.c) return event.level;
    if (event.event === "DISPLACEMENT_UP" || event.event === "PULLBACK_COMPLETE") {
      const swing = structure.lastLow?.price;
      if (swing != null && swing < bar.c) return Math.min(swing, bar.l);
    }
    return bar.l < bar.c ? bar.l : null;
  }
  if (event.event === "BREAKOUT_DOWN" && event.level != null && event.level > bar.c) return event.level;
  if (event.event === "DISPLACEMENT_DOWN" || event.event === "PULLBACK_COMPLETE") {
    const swing = structure.lastHigh?.price;
    if (swing != null && swing > bar.c) return Math.max(swing, bar.h);
  }
  return bar.h > bar.c ? bar.h : null;
}

/**
 * Lectura objetiva cuando ningún setup de prioridad 1 está completo.
 * Devuelve null si falta cualquiera de las piezas obligatorias.
 */
export function partialAt(
  bars: readonly Bar[],
  i: number,
  state: MarketState,
  structure: StructureView,
  events: readonly PriceEvent[],
  ctx: ContextView,
): PartialReading | null {
  const bar = bars[i];
  const atr = ctx.atr;
  if (!bar || atr == null || !(atr > 0)) return null;
  if (state.state === "UNCLEAR" && !events.some((e) => e.level != null && e.event !== "NO_EVENT")) return null;

  const long = firstOf(events, LONG_EVENTS);
  const short = firstOf(events, SHORT_EVENTS);
  let side: Side | null = null;
  let event: PriceEvent | null = null;
  if (long && short) return null;
  if (long) {
    side = "LONG";
    event = long;
  } else if (short) {
    side = "SHORT";
    event = short;
  } else {
    const pull = events.find((e) => e.event === "PULLBACK_COMPLETE");
    if (!pull) return null;
    if (structure.hh && structure.hl && !structure.bosDown && state.state !== "TREND_DOWN") {
      side = "LONG";
      event = pull;
    } else if (structure.lh && structure.ll && !structure.bosUp && state.state !== "TREND_UP") {
      side = "SHORT";
      event = pull;
    } else return null;
  }

  if (!structureOk(side, event, structure, state)) return null;
  if (!candleConfirms(bar, side)) return null;
  const defended = defendedOf(side, bar, event, structure);
  if (defended == null || !Number.isFinite(defended)) return null;
  if (side === "LONG" && !(defended < bar.c)) return null;
  if (side === "SHORT" && !(defended > bar.c)) return null;
  if (Math.abs(bar.c - defended) / atr > PARAMS.locationAtr) return null;

  return {
    direction: side,
    setup: setupFor(event.event, side, state),
    defended,
    event: event.event,
    evidence: {
      structure: true,
      direction: true,
      event: true,
      confirmation: true,
      location: true,
      partial: true,
    },
  };
}
