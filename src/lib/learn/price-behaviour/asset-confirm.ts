/**
 * Confirmación extra por activo. No abre una operación por sí sola.
 * Si no aplica al setup, el motor común sigue. Si aplica y falla, ESPERAR.
 * Umbrales fijados antes del replay. No se reajustan después de ver TRAIN/TEST.
 */
import { sessionId } from "./context.ts";
import { hasEvent } from "./events.ts";
import { PARAMS } from "./params.ts";
import type { AssetId, Bar, MarketState, PriceEvent, SetupId, Side, StructureView } from "./types.ts";

export const FIB_RATIOS = [0.382, 0.5, 0.618] as const;
const FIB_PAD_ATR = 0.35;
const IMPULSE_MIN_ATR = 1;

export interface ConfirmInput {
  asset: AssetId;
  bars: readonly Bar[];
  i: number;
  side: Side;
  setup: SetupId;
  structure: StructureView;
  state: MarketState;
  events: readonly PriceEvent[];
  atr: number;
}

/** null = el motor común queda en pie. Un texto = la confirmación del activo falla. */
export function assetConfirmFail(input: ConfirmInput): string | null {
  if (input.asset === "XAUUSD") return xauFib(input);
  if (input.asset === "BTCUSD") return btcBreakout(input);
  if (input.asset === "US100") return us100Momentum(input);
  return wtiContinuation(input);
}

function xauFib(input: ConfirmInput): string | null {
  if (input.setup !== "TREND_PULLBACK") return null;
  const impulse = impulseOf(input.structure, input.side);
  if (!impulse) return "XAU: el retroceso no tiene un impulso estructural medible.";
  const span = impulse.high - impulse.low;
  if (!(input.atr > 0) || span < IMPULSE_MIN_ATR * input.atr) return "XAU: el impulso no cubre un ATR.";
  const levels = FIB_RATIOS.map((ratio) =>
    input.side === "LONG" ? impulse.high - ratio * span : impulse.low + ratio * span,
  );
  const bar = input.bars[input.i]!;
  const pad = FIB_PAD_ATR * input.atr;
  const near = levels.some((level) => bar.l - pad <= level && level <= bar.h + pad);
  if (!near) return "XAU: el retroceso no está en 38.2, 50 ni 61.8.";
  return null;
}

function btcBreakout(input: ConfirmInput): string | null {
  if (input.setup !== "BREAKOUT_ACCEPTANCE" && input.setup !== "EXPANSION_CONTINUATION") return null;
  const bar = input.bars[input.i]!;
  const range = bar.h - bar.l;
  if (!(range > 0) || input.structure.rangeHigh == null || input.structure.rangeLow == null) {
    return "BTC: no hay rango estructural que romper.";
  }
  const loc = (bar.c - bar.l) / range;
  const prev = input.i > 0 ? input.bars[input.i - 1]! : null;
  if (input.side === "LONG") {
    const rejected = hasEvent(input.events, "FAILED_BREAKOUT_UP") || hasEvent(input.events, "REJECTION_HIGH") || bar.c <= input.structure.rangeHigh;
    if (rejected) return "BTC: la ruptura alcista no está aceptada.";
    const upper = (bar.h - Math.max(bar.o, bar.c)) / range;
    const continued = (prev != null && bar.c > prev.c) || hasEvent(input.events, "DISPLACEMENT_UP");
    if (upper >= PARAMS.rejectionMaxOppositeWick || loc < 0.6 || !continued) return "BTC: falta continuación tras la ruptura.";
    return null;
  }
  const rejected = hasEvent(input.events, "FAILED_BREAKOUT_DOWN") || hasEvent(input.events, "REJECTION_LOW") || bar.c >= input.structure.rangeLow;
  if (rejected) return "BTC: la ruptura bajista no está aceptada.";
  const lower = (Math.min(bar.o, bar.c) - bar.l) / range;
  const continued = (prev != null && bar.c < prev.c) || hasEvent(input.events, "DISPLACEMENT_DOWN");
  if (lower >= PARAMS.rejectionMaxOppositeWick || loc > 0.4 || !continued) return "BTC: falta continuación tras la ruptura.";
  return null;
}

function us100Momentum(input: ConfirmInput): string | null {
  if (input.setup !== "BREAKOUT_ACCEPTANCE" && input.setup !== "EXPANSION_CONTINUATION") return null;
  if (!aligned(input.structure, input.state, input.side)) return "US100: la vela no tiene dirección estructural.";
  const bar = input.bars[input.i]!;
  const range = bar.h - bar.l;
  if (!(range > 0) || !(input.atr > 0) || range < PARAMS.expansionRangeAtr * input.atr) {
    return "US100: no es expansión de rango.";
  }
  const loc = (bar.c - bar.l) / range;
  const body = Math.abs(bar.c - bar.o) / range;
  const prev = input.i > 0 ? input.bars[input.i - 1]! : null;
  if (input.side === "LONG") {
    const strong = bar.c > bar.o && loc >= PARAMS.closeExtreme && body >= PARAMS.displacementBodyFrac;
    const continued = prev != null && bar.c > prev.c;
    if (!strong || !continued) return "US100: la expansión no cierra con continuación.";
    return null;
  }
  const strong = bar.c < bar.o && loc <= 1 - PARAMS.closeExtreme && body >= PARAMS.displacementBodyFrac;
  const continued = prev != null && bar.c < prev.c;
  if (!strong || !continued) return "US100: la expansión no cierra con continuación.";
  return null;
}

function wtiContinuation(input: ConfirmInput): string | null {
  const bar = input.bars[input.i]!;
  const prev = input.i > 0 ? input.bars[input.i - 1]! : null;
  if (!prev) return "WTI: no hay vela previa para confirmar continuación.";
  if (sessionId(bar.t, "WTI") !== sessionId(prev.t, "WTI")) return "WTI: la vela de apertura de sesión no es una entrada.";
  if (!aligned(input.structure, input.state, input.side)) return "WTI: no hay dirección estructural.";
  const from = Math.max(0, input.i - PARAMS.eventLookback);
  let impulse = false;
  for (let k = from; k < input.i; k++) {
    if (displacementBar(input.bars[k]!, input.atr, input.side)) {
      impulse = true;
      break;
    }
  }
  if (!impulse && !hasEvent(input.events, input.side === "LONG" ? "DISPLACEMENT_UP" : "DISPLACEMENT_DOWN")) {
    return "WTI: no hay impulso previo.";
  }
  const against = input.side === "LONG" ? hasEvent(input.events, "REJECTION_HIGH") : hasEvent(input.events, "REJECTION_LOW");
  const continued = input.side === "LONG" ? bar.c > prev.c : bar.c < prev.c;
  if (!continued || against) return "WTI: el impulso no tiene continuación.";
  return null;
}

function impulseOf(structure: StructureView, side: Side): { low: number; high: number } | null {
  const high = structure.lastHigh?.price;
  const low = structure.lastLow?.price;
  if (high == null || low == null || !(high > low)) return null;
  if (side === "LONG" && structure.hh && structure.hl && !structure.bosDown) return { low, high };
  if (side === "SHORT" && structure.lh && structure.ll && !structure.bosUp) return { low, high };
  return null;
}

function aligned(structure: StructureView, state: MarketState, side: Side): boolean {
  if (side === "LONG") return (structure.hh && structure.hl && !structure.bosDown) || state.state === "TREND_UP";
  return (structure.lh && structure.ll && !structure.bosUp) || state.state === "TREND_DOWN";
}

function displacementBar(bar: Bar, atr: number, side: Side): boolean {
  const range = bar.h - bar.l;
  if (!(atr > 0) || !(range >= PARAMS.displacementRangeAtr * atr)) return false;
  const body = Math.abs(bar.c - bar.o);
  if (!(range > 0) || body / range < PARAMS.displacementBodyFrac) return false;
  const loc = (bar.c - bar.l) / range;
  if (side === "LONG") return bar.c > bar.o && loc >= PARAMS.displacementCloseLoc;
  return bar.c < bar.o && loc <= 1 - PARAMS.displacementCloseLoc;
}
