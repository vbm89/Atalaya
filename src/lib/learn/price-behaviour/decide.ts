import { candleAt } from "./candle.ts";
import { contextAt } from "./context.ts";
import { eventsAt, primaryEvent } from "./events.ts";
import { PARAMS } from "./params.ts";
import { partialAt } from "./partial.ts";
import { SETUP_PRIORITY, setupsAt } from "./setups.ts";
import { marketStateAt } from "./state.ts";
import { structureAt } from "./structure.ts";
import type {
  AssetId,
  Bar,
  Decision,
  Explanation,
  MarketState,
  PriceEvent,
  SetupHit,
  Side,
  StructureView,
  WaitReason,
} from "./types.ts";

const STATE_ES: Record<MarketState["state"], string> = {
  TREND_UP: "Tendencia alcista",
  TREND_DOWN: "Tendencia bajista",
  RANGE: "Rango",
  COMPRESSION: "Compresión",
  EXPANSION: "Expansión",
  REVERSAL_ATTEMPT: "Intento de giro",
  UNCLEAR: "Lectura poco clara",
};

const EVENT_ES: Record<string, string> = {
  BREAKOUT_UP: "Ruptura alcista con cierre fuera",
  BREAKOUT_DOWN: "Ruptura bajista con cierre fuera",
  SWEEP_HIGH: "Barrido del máximo y vuelta dentro",
  SWEEP_LOW: "Barrido del mínimo y vuelta dentro",
  RECLAIM_UP: "Recuperación del nivel perdido",
  RECLAIM_DOWN: "Pérdida del nivel recuperado",
  REJECTION_HIGH: "Rechazo en máximos",
  REJECTION_LOW: "Rechazo en mínimos",
  DISPLACEMENT_UP: "Desplazamiento alcista",
  DISPLACEMENT_DOWN: "Desplazamiento bajista",
  PULLBACK: "Retroceso dentro de la estructura",
  PULLBACK_COMPLETE: "Retroceso con reacción",
  COMPRESSION: "Compresión de rangos",
  EXPANSION: "Expansión de rango",
  FAILED_BREAKOUT_UP: "Ruptura alcista fallida",
  FAILED_BREAKOUT_DOWN: "Ruptura bajista fallida",
  NO_EVENT: "Sin evento de precio",
};

const SETUP_ES: Record<string, string> = {
  TREND_PULLBACK: "retroceso en tendencia",
  BREAKOUT_ACCEPTANCE: "aceptación de ruptura",
  SWEEP_RECLAIM: "barrido y recuperación",
  FAILED_BREAKOUT: "ruptura fallida",
  EXPANSION_CONTINUATION: "continuación tras expansión",
};

function blankState(): MarketState {
  return { state: "UNCLEAR", confidence: 0, evidence: [] };
}

function explanation(partial: Partial<Explanation> & { decision: string }): Explanation {
  return {
    estado: partial.estado ?? "Sin lectura",
    evento: partial.evento ?? "Sin evento",
    estructura: partial.estructura ?? "Sin estructura utilizable",
    confirmacion: partial.confirmacion ?? "Incompleta",
    entrada: partial.entrada ?? "—",
    sl: partial.sl ?? "—",
    tp: partial.tp ?? "—",
    rr: partial.rr ?? "—",
    decision: partial.decision,
    narrativa: partial.narrativa ?? partial.decision,
  };
}

function waiting(args: {
  asset: AssetId;
  bars: readonly Bar[];
  i: number;
  reason: WaitReason;
  detail: string;
  state?: MarketState;
  events?: PriceEvent[];
  setup?: SetupHit | null;
  direction?: Side | null;
  narrative: string;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  rr?: number | null;
}): Decision {
  const bar = args.bars[args.i];
  const structure = args.i >= 0 && args.bars.length > args.i ? structureAt(args.bars, args.i) : null;
  const ctx = structure ? contextAt(args.bars, args.i, args.asset, structure) : null;
  const candle = bar ? candleAt(args.bars, args.i, ctx?.atr ?? null) : null;
  const events = args.events ?? [];
  const event = events.length ? primaryEvent(events) : "NO_EVENT";
  const state = args.state ?? blankState();
  const exp = explanation({
    estado: STATE_ES[state.state],
    evento: EVENT_ES[event] ?? event,
    estructura: structureText(structure),
    confirmacion: args.setup?.complete ? "Completa, pero el riesgo no autoriza la orden" : "Incompleta",
    entrada: args.entry != null ? args.entry.toFixed(4) : "—",
    sl: args.stop != null ? args.stop.toFixed(4) : "—",
    tp: args.target != null ? args.target.toFixed(4) : "—",
    rr: args.rr != null ? args.rr.toFixed(2) : "—",
    decision: "ESPERAR",
    narrativa: args.narrative,
  });
  return {
    asset: args.asset,
    timestamp: bar ? bar.t + PARAMS.barSec : null,
    barOpenT: bar?.t ?? null,
    action: "ESPERAR",
    direction: args.direction ?? args.setup?.direction ?? null,
    marketState: state,
    setup: args.setup?.id ?? null,
    event,
    events,
    confirmation: false,
    entry: null,
    stop: args.reason === "RR_INSUFFICIENT" || args.reason === "INVALIDATION" ? (args.stop ?? null) : null,
    target: args.reason === "RR_INSUFFICIENT" ? (args.target ?? null) : null,
    targetSource: null,
    rr: args.rr ?? null,
    risk: args.entry != null && args.stop != null ? Math.abs(args.entry - args.stop) : null,
    evidence: args.setup?.evidence ?? {},
    missingEvidence: args.setup?.missing ?? [],
    levels: levelsOf(structure, ctx, args.setup?.defended ?? null),
    context: ctx ?? emptyContext(),
    candle,
    explanation: exp,
    reason: args.reason,
    detail: args.detail,
    tier: null,
    mode: "learning",
    validatedEdge: false,
    liveTrading: false,
  };
}

function emptyContext(): Decision["context"] {
  return {
    ema: null,
    atr: null,
    atrPercentile: null,
    distStructureAtr: null,
    distSessionHighAtr: null,
    distSessionLowAtr: null,
    distRecentHighAtr: null,
    distRecentLowAtr: null,
    distEmaAtr: null,
    volatility: "UNKNOWN",
    session: "UNKNOWN",
    sessionHigh: null,
    sessionLow: null,
    htf1h: "UNKNOWN",
    htf4h: "UNKNOWN",
  };
}

function levelsOf(structure: StructureView | null, ctx: Decision["context"] | null, defended: number | null): Decision["levels"] {
  return {
    swingHigh: structure?.lastHigh?.price ?? null,
    swingLow: structure?.lastLow?.price ?? null,
    rangeHigh: structure?.rangeHigh ?? null,
    rangeLow: structure?.rangeLow ?? null,
    recentHigh: structure?.recentHigh ?? null,
    recentLow: structure?.recentLow ?? null,
    sessionHigh: ctx?.sessionHigh ?? null,
    sessionLow: ctx?.sessionLow ?? null,
    ema: ctx?.ema ?? null,
    atr: ctx?.atr ?? null,
    defended,
  };
}

function structureText(structure: StructureView | null): string {
  if (!structure) return "Sin estructura utilizable";
  if (structure.hh && structure.hl) return "HH/HL vigente";
  if (structure.lh && structure.ll) return "LH/LL vigente";
  if (structure.bosUp) return "Ruptura de máximo estructural";
  if (structure.bosDown) return "Ruptura de mínimo estructural";
  return "Sin secuencia clara de swings";
}

export interface RiskAssessment {
  ok: boolean;
  reason: "READY" | "INVALIDATION" | "RR_INSUFFICIENT" | "NO_TARGET";
  stop: number | null;
  target: number | null;
  targetSource: string | null;
  rr: number | null;
  risk: number | null;
  detail: string;
}

/** Geometría fija. No cambia el objetivo para que el R:R supere 1.5. */
export function assessRisk(args: {
  direction: Side;
  entry: number;
  defended: number | null;
  atr: number;
  target: number | null;
  targetSource: string | null;
}): RiskAssessment {
  if (args.defended == null || !Number.isFinite(args.defended) || !(args.atr > 0)) {
    return { ok: false, reason: "INVALIDATION", stop: null, target: args.target, targetSource: args.targetSource, rr: null, risk: null, detail: "No hay nivel que invalide la hipótesis." };
  }
  const stop =
    args.direction === "LONG"
      ? args.defended - PARAMS.atrBufferFrac * args.atr
      : args.defended + PARAMS.atrBufferFrac * args.atr;
  const risk = args.direction === "LONG" ? args.entry - stop : stop - args.entry;
  if (!(risk > 0) || (args.direction === "LONG" ? args.defended >= args.entry : args.defended <= args.entry)) {
    return {
      ok: false,
      reason: "INVALIDATION",
      stop,
      target: args.target,
      targetSource: args.targetSource,
      rr: null,
      risk,
      detail: "El precio ya ha cruzado la estructura que tenía que aguantar.",
    };
  }
  if (risk < PARAMS.minRiskAtr * args.atr || risk > PARAMS.maxRiskAtr * args.atr) {
    return {
      ok: false,
      reason: "INVALIDATION",
      stop,
      target: args.target,
      targetSource: args.targetSource,
      rr: null,
      risk,
      detail:
        risk < PARAMS.minRiskAtr * args.atr
          ? "El stop queda dentro del ruido del ATR. No se aprieta para mejorar el R:R."
          : "La estructura queda demasiado lejos. No se aleja el objetivo para compensar.",
    };
  }
  if (args.target == null || !Number.isFinite(args.target)) {
    return { ok: false, reason: "NO_TARGET", stop, target: null, targetSource: null, rr: null, risk, detail: "No hay objetivo estructural ni fallback aplicable." };
  }
  const reward = args.direction === "LONG" ? args.target - args.entry : args.entry - args.target;
  if (!(reward > 0)) {
    return { ok: false, reason: "NO_TARGET", stop, target: args.target, targetSource: args.targetSource, rr: null, risk, detail: "El siguiente nivel no queda a favor de la operación." };
  }
  const rr = reward / risk;
  if (rr < PARAMS.minRr) {
    return {
      ok: false,
      reason: "RR_INSUFFICIENT",
      stop,
      target: args.target,
      targetSource: args.targetSource,
      rr,
      risk,
      detail: `R:R ${rr.toFixed(2)} por debajo de ${PARAMS.minRr}. No se fabrica otro objetivo.`,
    };
  }
  return { ok: true, reason: "READY", stop, target: args.target, targetSource: args.targetSource, rr, risk, detail: "Riesgo detrás de la estructura y objetivo ya existente." };
}

/**
 * Niveles estructurales ya existentes, del más cercano al más lejano.
 * Si el más cercano no paga el R:R mínimo, se prueba el siguiente.
 * Si ninguno llega, se conserva el más cercano. El fallback de ATR solo
 * entra cuando no hay ningún nivel en la dirección. No se fabrican precios.
 */
export function selectTarget(
  direction: Side,
  entry: number,
  structure: StructureView,
  sessionHigh: number | null,
  sessionLow: number | null,
  atr: number,
  defended: number | null = null,
): { price: number; source: string } | null {
  const pool: { price: number; source: string }[] = [];
  const add = (price: number | null | undefined, source: string) => {
    if (price == null || !Number.isFinite(price)) return;
    const inDirection = direction === "LONG" ? price > entry : price < entry;
    if (!inDirection) return;
    if (pool.some((row) => row.price === price)) return;
    pool.push({ price, source });
  };
  add(structure.lastHigh?.price, "swing_high");
  add(structure.prevHigh?.price, "prev_swing_high");
  add(structure.lastLow?.price, "swing_low");
  add(structure.prevLow?.price, "prev_swing_low");
  add(structure.rangeHigh, "range_high");
  add(structure.recentHigh, "recent_high");
  add(structure.rangeLow, "range_low");
  add(structure.recentLow, "recent_low");
  add(sessionHigh, "session_high");
  add(sessionLow, "session_low");
  pool.sort((a, b) => (direction === "LONG" ? a.price - b.price : b.price - a.price));

  const level =
    defended != null && Number.isFinite(defended) && (direction === "LONG" ? defended < entry : defended > entry)
      ? defended
      : null;
  const stop =
    level != null && atr > 0
      ? direction === "LONG"
        ? level - PARAMS.atrBufferFrac * atr
        : level + PARAMS.atrBufferFrac * atr
      : null;
  const risk = stop == null ? null : direction === "LONG" ? entry - stop : stop - entry;
  if (risk != null && risk > 0 && atr > 0 && risk >= PARAMS.minRiskAtr * atr && risk <= PARAMS.maxRiskAtr * atr) {
    for (const row of pool) {
      const reward = direction === "LONG" ? row.price - entry : entry - row.price;
      if (reward > 0 && reward / risk >= PARAMS.minRr) return row;
    }
  }

  if (pool.length) return pool[0]!;
  if (!(atr > 0)) return null;
  return direction === "LONG"
    ? { price: entry + PARAMS.targetAtrFallback * atr, source: "ATR_FALLBACK" }
    : { price: entry - PARAMS.targetAtrFallback * atr, source: "ATR_FALLBACK" };
}

export function decide(bars: readonly Bar[], i: number, asset: AssetId): Decision {
  if (i < PARAMS.warmup || i >= bars.length) {
    return waiting({
      asset,
      bars,
      i: Math.min(i, bars.length - 1),
      reason: i >= bars.length ? "DATA" : "WARMUP",
      detail: "Hace falta más vela cerrada para leer estructura.",
      narrative: "Ahora mismo no hay suficiente cinta cerrada.",
    });
  }
  const structure = structureAt(bars, i);
  const ctx = contextAt(bars, i, asset, structure);
  if (ctx.atr == null) {
    return waiting({
      asset,
      bars,
      i,
      reason: "DATA",
      detail: "ATR no calculable.",
      narrative: "Sin volatilidad de referencia no hay decisión.",
    });
  }
  const events = eventsAt(bars, i, structure, ctx);
  const state = marketStateAt(bars, i, structure, ctx, events.map((e) => e.event));
  const candle = candleAt(bars, i, ctx.atr);
  const setups = setupsAt(bars, i, state, structure, events, ctx);
  const complete = setups.filter((s) => s.complete);
  const directions = new Set(complete.map((s) => s.direction));
  if (directions.size > 1) {
    return waiting({
      asset,
      bars,
      i,
      reason: "CONTRADICTION",
      detail: "Hay setups completos en direcciones opuestas.",
      state,
      events,
      narrative: "Hay señales en contra. ESPERAR.",
    });
  }
  const chosen = SETUP_PRIORITY.map((id) => complete.find((s) => s.id === id)).find((s) => s != null) ?? null;
  const closest = chosen ?? setups.slice().sort((a, b) => a.missing.length - b.missing.length)[0] ?? null;

  if (!chosen) {
    const brokeLong = structure.hh && structure.hl && structure.bosDown;
    const brokeShort = structure.lh && structure.ll && structure.bosUp;
    if (!brokeLong && !brokeShort) {
      const partial = partialAt(bars, i, state, structure, events, ctx);
      if (partial) {
        const entry = bars[i]!.c;
        const target = selectTarget(partial.direction, entry, structure, ctx.sessionHigh, ctx.sessionLow, ctx.atr, partial.defended);
        const risk = assessRisk({
          direction: partial.direction,
          entry,
          defended: partial.defended,
          atr: ctx.atr,
          target: target?.price ?? null,
          targetSource: target?.source ?? null,
        });
        const named = closest && closest.direction === partial.direction ? closest : null;
        const absent = named?.missing ?? [];
        if (!risk.ok) {
          return {
            ...waiting({
              asset,
              bars,
              i,
              reason: risk.reason === "READY" ? "NO_SETUP" : risk.reason,
              detail: risk.detail,
              state,
              events,
              setup: { ...named, id: partial.setup, direction: partial.direction, complete: false, evidence: partial.evidence, missing: absent, defended: partial.defended },
              narrative:
                risk.reason === "RR_INSUFFICIENT"
                  ? `Hay lectura de ${SETUP_ES[partial.setup]}, pero el siguiente nivel no paga el riesgo. ESPERAR.`
                  : `${risk.detail} ESPERAR.`,
              entry,
              stop: risk.stop,
              target: risk.target,
              rr: risk.rr,
            }),
            candle,
            context: ctx,
            levels: levelsOf(structure, ctx, partial.defended),
            evidence: partial.evidence,
            missingEvidence: absent,
            confirmation: true,
            setup: partial.setup,
            event: partial.event,
            marketState: state,
            tier: null,
          };
        }
        const action = partial.direction === "LONG" ? "COMPRA" : "VENTA";
        const absentNote = absent.length ? ` No hace falta ${absent.join(", ")}: la lectura ya tiene estructura, evento y confirmación.` : "";
        const narrativa = `${STATE_ES[state.state]}. ${EVENT_ES[partial.event]}. Lectura parcial de ${SETUP_ES[partial.setup]}: dirección clara, vela de confirmación y riesgo detrás de la estructura.${absentNote} Hipótesis operativa. El edge no está validado.`;
        return {
          asset,
          timestamp: bars[i]!.t + PARAMS.barSec,
          barOpenT: bars[i]!.t,
          action,
          direction: partial.direction,
          marketState: state,
          setup: partial.setup,
          event: partial.event,
          events,
          confirmation: true,
          entry,
          stop: risk.stop,
          target: risk.target,
          targetSource: risk.targetSource,
          rr: risk.rr,
          risk: risk.risk,
          evidence: partial.evidence,
          missingEvidence: absent,
          levels: levelsOf(structure, ctx, partial.defended),
          context: ctx,
          candle,
          explanation: explanation({
            estado: STATE_ES[state.state],
            evento: EVENT_ES[partial.event] ?? partial.event,
            estructura: structureText(structure),
            confirmacion: "Vela cerrada a favor, sin exigir el resto de piezas del setup.",
            entrada: entry.toFixed(4),
            sl: risk.stop!.toFixed(4),
            tp: risk.target!.toFixed(4),
            rr: risk.rr!.toFixed(2),
            decision: action,
            narrativa,
          }),
          reason: "READY",
          detail: risk.detail,
          tier: "PARTIAL",
          mode: "learning",
          validatedEdge: false,
          liveTrading: false,
        };
      }
    }
    const reason: WaitReason = brokeLong || brokeShort ? "INVALIDATION" : closest?.missing.length ? "INCOMPLETE" : "NO_SETUP";
    const missing = closest?.missing ?? [];
    return {
      ...waiting({
        asset,
        bars,
        i,
        reason,
        detail: missing.length ? `Falta: ${missing.join(", ")}` : "No hay setup completo.",
        state,
        events,
        setup: closest,
        narrative:
          reason === "INVALIDATION"
            ? "La estructura que sostenía la lectura se ha roto y la confirmación contraria no está completa. ESPERAR."
            : missing.length
              ? `Hay un esbozo de ${closest ? SETUP_ES[closest.id] : "setup"}, pero falta ${missing.join(", ")}. ESPERAR.`
              : "Ahora mismo no hay nada claro. ESPERAR.",
      }),
      candle,
      context: ctx,
      levels: levelsOf(structure, ctx, closest?.defended ?? null),
      marketState: state,
    };
  }

  const entry = bars[i]!.c;
  const target = selectTarget(chosen.direction, entry, structure, ctx.sessionHigh, ctx.sessionLow, ctx.atr, chosen.defended);
  const risk = assessRisk({
    direction: chosen.direction,
    entry,
    defended: chosen.defended,
    atr: ctx.atr,
    target: target?.price ?? null,
    targetSource: target?.source ?? null,
  });
  if (!risk.ok) {
    return {
      ...waiting({
        asset,
        bars,
        i,
        reason: risk.reason === "READY" ? "NO_SETUP" : risk.reason,
        detail: risk.detail,
        state,
        events,
        setup: chosen,
        narrative:
          risk.reason === "RR_INSUFFICIENT"
            ? `El setup de ${SETUP_ES[chosen.id]} está completo, pero el siguiente nivel no paga el riesgo. ESPERAR.`
            : `${risk.detail} ESPERAR.`,
        entry,
        stop: risk.stop,
        target: risk.target,
        rr: risk.rr,
      }),
      candle,
      context: ctx,
      levels: levelsOf(structure, ctx, chosen.defended),
      evidence: chosen.evidence,
      missingEvidence: [],
      confirmation: true,
      setup: chosen.id,
      marketState: state,
    };
  }

  const action = chosen.direction === "LONG" ? "COMPRA" : "VENTA";
  const event = primaryEvent(events);
  const htfNote =
    ctx.htf1h === "UNKNOWN"
      ? ""
      : chosen.direction === "LONG"
        ? ctx.htf1h === "UP"
          ? " El 1H acompaña."
          : " El 1H no acompaña: es contexto, no un veto."
        : ctx.htf1h === "DOWN"
          ? " El 1H acompaña."
          : " El 1H no acompaña: es contexto, no un veto.";
  const narrativa = `${STATE_ES[state.state]}. ${EVENT_ES[event]}. Setup ${SETUP_ES[chosen.id]} completo, confirmación presente y el riesgo queda detrás de la estructura.${htfNote}`;
  return {
    asset,
    timestamp: bars[i]!.t + PARAMS.barSec,
    barOpenT: bars[i]!.t,
    action,
    direction: chosen.direction,
    marketState: state,
    setup: chosen.id,
    event,
    events,
    confirmation: true,
    entry,
    stop: risk.stop,
    target: risk.target,
    targetSource: risk.targetSource,
    rr: risk.rr,
    risk: risk.risk,
    evidence: chosen.evidence,
    missingEvidence: [],
    levels: levelsOf(structure, ctx, chosen.defended),
    context: ctx,
    candle,
    explanation: explanation({
      estado: STATE_ES[state.state],
      evento: EVENT_ES[event] ?? event,
      estructura: structureText(structure),
      confirmacion: "El precio está haciendo lo que el setup pedía.",
      entrada: entry.toFixed(4),
      sl: risk.stop!.toFixed(4),
      tp: risk.target!.toFixed(4),
      rr: risk.rr!.toFixed(2),
      decision: action,
      narrativa,
    }),
    reason: "READY",
    detail: risk.detail,
    tier: "FULL",
    mode: "learning",
    validatedEdge: false,
    liveTrading: false,
  };
}

export function latestDecision(bars: readonly Bar[], asset: AssetId): Decision {
  if (!bars.length) {
    return waiting({
      asset,
      bars,
      i: 0,
      reason: "DATA",
      detail: "Cinta vacía.",
      narrative: "Sin velas no hay lectura.",
    });
  }
  return decide(bars, bars.length - 1, asset);
}
