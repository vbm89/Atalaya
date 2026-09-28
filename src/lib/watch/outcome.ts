import type { Candle } from "../trading/types";

/**
 * Regla de desenlace v1 (capa externa, no es V1):
 * «primer toque de mecha en velas 15M posteriores al slot de apertura».
 *
 * - No usa M1 (no está en el tick 24/7 de todos los activos).
 * - No usa el cierre: un SL/TP de trading se considera tocado por mecha.
 * - Si SL y TP1/TP2 caen en la MISMA vela, gana SL (conservador).
 * - Las velas del slot de decisión no cuentan: el toque es posterior.
 * - Caducidad (episodio cerrado sin toque) → expired, no un win/loss inventado.
 */
export const OUTCOME_RULE = "m15-wick-first-touch-sl-wins-same-bar";

export type OutcomeKind = "pending" | "sl" | "tp1" | "tp2" | "none" | "expired";

export interface OutcomeInput {
  direction: "buy" | "sell";
  sl: number;
  tp1: number;
  tp2: number | null;
  zoneLow: number;
  zoneHigh: number;
  openedSlot: number;
  closed: boolean;
  candles: Candle[];
}

export interface OutcomeResult {
  rule: typeof OUTCOME_RULE;
  outcome: OutcomeKind;
  firstTouch: "sl" | "tp1" | "tp2" | null;
  firstTouchAtSec: number | null;
  exitAtSec: number | null;
  mfe: number | null;
  mae: number | null;
}

function laterBars(candles: Candle[], openedSlot: number): Candle[] {
  return candles.filter((c) => c.time >= openedSlot).sort((a, b) => a.time - b.time);
}

function touches(direction: "buy" | "sell", c: Candle, level: number, side: "sl" | "tp"): boolean {
  if (direction === "sell") {
    return side === "sl" ? c.high >= level : c.low <= level;
  }
  return side === "sl" ? c.low <= level : c.high >= level;
}

function excursion(direction: "buy" | "sell", entry: number, c: Candle): { mfe: number; mae: number } {
  if (direction === "sell") {
    return { mfe: entry - c.low, mae: c.high - entry };
  }
  return { mfe: c.high - entry, mae: entry - c.low };
}

export function resolveOutcome(input: OutcomeInput): OutcomeResult {
  const bars = laterBars(input.candles, input.openedSlot);
  const entry = input.direction === "sell" ? input.zoneHigh : input.zoneLow;
  let mfe = 0;
  let mae = 0;
  let first: OutcomeResult["firstTouch"] = null;
  let firstAt: number | null = null;

  for (const c of bars) {
    const ex = excursion(input.direction, entry, c);
    if (ex.mfe > mfe) mfe = ex.mfe;
    if (ex.mae > mae) mae = ex.mae;

    const hitSl = touches(input.direction, c, input.sl, "sl");
    const hitTp1 = touches(input.direction, c, input.tp1, "tp");
    const hitTp2 = input.tp2 != null && touches(input.direction, c, input.tp2, "tp");
    if (hitSl) {
      first = "sl";
      firstAt = c.time;
      break;
    }
    if (hitTp1) {
      first = "tp1";
      firstAt = c.time;
      break;
    }
    if (hitTp2) {
      first = "tp2";
      firstAt = c.time;
      break;
    }
  }

  if (first) {
    return {
      rule: OUTCOME_RULE,
      outcome: first,
      firstTouch: first,
      firstTouchAtSec: firstAt,
      exitAtSec: firstAt,
      mfe,
      mae,
    };
  }

  if (input.closed) {
    return {
      rule: OUTCOME_RULE,
      outcome: "expired",
      firstTouch: null,
      firstTouchAtSec: null,
      exitAtSec: null,
      mfe,
      mae,
    };
  }

  return {
    rule: OUTCOME_RULE,
    outcome: "pending",
    firstTouch: null,
    firstTouchAtSec: null,
    exitAtSec: null,
    mfe: bars.length ? mfe : null,
    mae: bars.length ? mae : null,
  };
}
