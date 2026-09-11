import type { ShadowCandidateResult, ShadowEpisode, ShadowTapeBar } from "./shadow-replay";

export type ShadowFirstTouch = "sl" | "tp1" | "tp2" | null;
export type ShadowPathTerminal = "sl" | "tp1" | "tp2" | "expired" | "pending";

export interface ShadowPathOutcome extends ShadowCandidateResult {
  firstTouch: ShadowFirstTouch;
  reachedTp1: boolean;
  reachedTp2: boolean;
  terminal: ShadowPathTerminal;
  mfeBeforeSl: number | null;
  timeToTp1Sec: number | null;
  timeToSlSec: number | null;
  sameBarAmbiguous: boolean;
}

function excursion(direction: ShadowEpisode["case"]["direction"], entry: number, bar: ShadowTapeBar) {
  if (direction === "sell") return { mfe: entry - bar.l, mae: bar.h - entry };
  return { mfe: bar.h - entry, mae: entry - bar.l };
}

function hits(direction: ShadowEpisode["case"]["direction"], bar: ShadowTapeBar, c: ShadowEpisode["case"]) {
  return {
    sl: direction === "sell" ? bar.h >= c.sl : bar.l <= c.sl,
    tp1: direction === "sell" ? bar.l <= c.tp1 : bar.h >= c.tp1,
    tp2: c.tp2 != null && (direction === "sell" ? bar.l <= c.tp2 : bar.h >= c.tp2),
  };
}

/**
 * Shadow-only path reconstruction after the decision candle has closed.
 * It preserves first touch separately from the eventual terminal outcome.
 * Same-bar SL + TP is conservatively terminal=SL and explicitly marked ambiguous.
 */
export function buildShadowPathOutcome(
  result: ShadowCandidateResult,
  episode: ShadowEpisode,
): ShadowPathOutcome {
  const c = episode.case;
  const bars = episode.bars
    .filter((b) => b.tf === "15m" && b.t >= result.decisionSlot)
    .sort((a, b) => a.t - b.t);

  let reachedTp1 = false;
  let reachedTp2 = false;
  let firstTouch: ShadowFirstTouch = null;
  let firstTouchAtSec: number | null = null;
  let timeToTp1Sec: number | null = null;
  let timeToSlSec: number | null = null;
  let mfe = 0;
  let mae = 0;
  let mfeBeforeSl: number | null = null;
  let sameBarAmbiguous = false;

  const risk = Math.abs(c.entry - c.sl);
  for (const bar of bars) {
    const ex = excursion(c.direction, c.entry, bar);
    const mfeBeforeBar = mfe;
    mfe = Math.max(mfe, ex.mfe);
    mae = Math.max(mae, ex.mae);
    const h = hits(c.direction, bar, c);

    if (h.tp1) {
      reachedTp1 = true;
      if (timeToTp1Sec == null) timeToTp1Sec = Math.max(0, bar.t - result.decisionSlot);
      if (firstTouch == null) {
        firstTouch = "tp1";
        firstTouchAtSec = bar.t;
      }
    }
    if (h.tp2) {
      reachedTp2 = true;
      if (firstTouch == null) {
        firstTouch = "tp2";
        firstTouchAtSec = bar.t;
      }
    }

    if (h.sl) {
      if (firstTouch == null) {
        firstTouch = "sl";
        firstTouchAtSec = bar.t;
      }
      timeToSlSec = Math.max(0, bar.t - result.decisionSlot);
      mfeBeforeSl = mfeBeforeBar;
      if (h.tp1 || h.tp2) sameBarAmbiguous = true;
      break;
    }
    if (h.tp2) break;
  }

  const terminal: ShadowPathTerminal = firstTouch == null
    ? (c.closedAtMs != null ? "expired" : "pending")
    : reachedTp2
      ? "tp2"
      : timeToSlSec != null
        ? "sl"
        : "tp1";

  const dataComplete = bars.length > 0 || c.closedAtMs != null;
  return {
    ...result,
    firstTouch,
    reachedTp1,
    reachedTp2,
    terminal,
    mfeBeforeSl,
    timeToTp1Sec,
    timeToSlSec,
    sameBarAmbiguous,
    firstTouchAtSec,
    dataComplete,
    mfe: bars.length ? mfe : null,
    mae: bars.length ? mae : null,
    mfeR: risk > 0 ? mfe / risk : null,
    maeR: risk > 0 ? mae / risk : null,
  };
}
