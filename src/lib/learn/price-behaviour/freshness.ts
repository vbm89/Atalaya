import type { Decision } from "./types.ts";

/** Una vela de 15m que lleva más de esto cerrada ya debería tener sucesora. */
export const FRESH_LAG_SEC = 25 * 60;

export type DataStatus = "DATA_OK" | "DATA_STALE" | "DATA_ERROR";

export function dataStatus(lastBarT: number | null, bars: number, nowSec: number, minBars: number): DataStatus {
  if (lastBarT == null || bars < minBars) return "DATA_ERROR";
  const age = nowSec - (lastBarT + 900);
  if (age > FRESH_LAG_SEC) return "DATA_STALE";
  return "DATA_OK";
}

export function gateDecision(decision: Decision, status: DataStatus, error: string | null): Decision {
  if (status === "DATA_OK") return decision;
  const stale = status === "DATA_STALE";
  const detail = stale ? "Datos desactualizados" : error?.trim() || "Datos no disponibles";
  return {
    ...decision,
    action: "ESPERAR",
    direction: null,
    confirmation: false,
    entry: null,
    stop: null,
    target: null,
    targetSource: null,
    rr: null,
    risk: null,
    tier: null,
    reason: "DATA",
    detail,
    explanation: {
      ...decision.explanation,
      confirmacion: "Sin cinta fiable",
      entrada: "—",
      sl: "—",
      tp: "—",
      rr: "—",
      decision: "ESPERAR",
      narrativa: stale
        ? "La última vela cerrada es demasiado antigua. No se decide con ella. ESPERAR."
        : "No hay datos suficientes para leer el precio. ESPERAR.",
    },
  };
}

export function shortWait(decision: Decision): string {
  if (decision.action !== "ESPERAR") return decision.explanation.narrativa;
  if (decision.reason === "DATA") {
    if (/desactualiz/i.test(decision.detail)) return "Datos desactualizados";
    return "Datos no disponibles";
  }
  if (decision.reason === "RR_INSUFFICIENT") return "RR insuficiente";
  if (decision.reason === "INVALIDATION") return "Estructura invalidada";
  if (decision.reason === "CONTRADICTION") return "Lecturas en contra";
  if (decision.reason === "NO_TARGET") return "Sin objetivo estructural";
  if (decision.reason === "WARMUP") return "Sin historial suficiente";
  if (decision.event === "NO_EVENT") return "Sin evento claro";
  if (decision.marketState.state === "UNCLEAR") return "Sin estructura";
  if (decision.event.startsWith("BREAKOUT")) return "Ruptura sin confirmación";
  if (decision.reason === "INCOMPLETE" || decision.reason === "NO_SETUP") return "Confirmación incompleta";
  return "Sin lectura suficiente";
}
