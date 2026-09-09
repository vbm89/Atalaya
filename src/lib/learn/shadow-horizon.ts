import type { ShadowCandidateResult, ShadowEpisode, ShadowCandidateReason } from "./shadow-replay";

export const SHADOW_HORIZONS = [
  { id: "6H", label: "Intradía · 6 h", seconds: 6 * 60 * 60 },
  { id: "1D", label: "1 día", seconds: 24 * 60 * 60 },
  { id: "2D", label: "2 días", seconds: 48 * 60 * 60 },
  { id: "3D", label: "3 días", seconds: 72 * 60 * 60 },
] as const;

export type ShadowHorizonId = (typeof SHADOW_HORIZONS)[number]["id"];

export interface ShadowHorizonVariant {
  variant: ShadowCandidateReason;
  candidates: number;
  dataComplete: number;
  openAtHorizon: number;
  tp1: number;
  tp2: number;
  sl: number;
  decided: number;
  successPct: number | null;
  meanOutcomeR: number | null;
  meanMfeR: number | null;
  meanMaeR: number | null;
}

export interface ShadowHorizonReport {
  generatedFromEpisodes: number;
  horizons: Array<{
    id: ShadowHorizonId;
    label: string;
    hours: number;
    variants: ShadowHorizonVariant[];
  }>;
  rule: string;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function outcomeFor(candidate: ShadowCandidateResult, ep: ShadowEpisode, horizonSec: number): {
  outcome: "pending" | "open" | "sl" | "tp1" | "tp2";
  rr: number | null;
  mfeR: number | null;
  maeR: number | null;
  complete: boolean;
} {
  const c = ep.case;
  const end = candidate.decisionSlot + horizonSec;
  const bars = ep.bars
    .filter((b) => b.tf === "15m" && b.t >= candidate.decisionSlot && b.t < end)
    .sort((a, b) => a.t - b.t);
  const expectedBars = Math.floor(horizonSec / 900);
  const complete = bars.length >= expectedBars;
  let mfe = 0;
  let mae = 0;
  for (const b of bars) {
    if (c.direction === "sell") {
      mfe = Math.max(mfe, c.entry - b.l);
      mae = Math.max(mae, b.h - c.entry);
    } else {
      mfe = Math.max(mfe, b.h - c.entry);
      mae = Math.max(mae, c.entry - b.l);
    }
    const hitSl = c.direction === "sell" ? b.h >= c.sl : b.l <= c.sl;
    const hitTp1 = c.direction === "sell" ? b.l <= c.tp1 : b.h >= c.tp1;
    const hitTp2 = c.tp2 != null && (c.direction === "sell" ? b.l <= c.tp2 : b.h >= c.tp2);
    const risk = Math.abs(c.entry - c.sl);

    // A level being reached is a real observed outcome even when the full
    // holding horizon is not yet available. `complete` only describes whether
    // the entire horizon is covered by tape; it must not erase a TP/SL hit.
    if (hitSl) return { outcome: "sl", rr: -1, mfeR: risk > 0 ? mfe / risk : null, maeR: risk > 0 ? mae / risk : null, complete };
    if (hitTp1) {
      const reward = Math.abs(c.tp1 - c.entry);
      return { outcome: "tp1", rr: risk > 0 ? reward / risk : null, mfeR: risk > 0 ? mfe / risk : null, maeR: risk > 0 ? mae / risk : null, complete };
    }
    if (hitTp2) {
      const reward = Math.abs(c.tp2! - c.entry);
      return { outcome: "tp2", rr: risk > 0 ? reward / risk : null, mfeR: risk > 0 ? mfe / risk : null, maeR: risk > 0 ? mae / risk : null, complete };
    }
  }

  const risk = Math.abs(c.entry - c.sl);
  return {
    outcome: complete ? "open" : "pending",
    rr: null,
    mfeR: bars.length && risk > 0 ? mfe / risk : null,
    maeR: bars.length && risk > 0 ? mae / risk : null,
    complete,
  };
}

export function buildShadowHorizonReport(
  episodes: readonly ShadowEpisode[],
  candidates: readonly ShadowCandidateResult[],
): ShadowHorizonReport {
  const variants = [...new Set(candidates.map((r) => r.variant))];
  return {
    generatedFromEpisodes: episodes.length,
    horizons: SHADOW_HORIZONS.map((h) => ({
      id: h.id,
      label: h.label,
      hours: h.seconds / 3600,
      variants: variants.map((variant) => {
        const rows = candidates.filter((r) => r.variant === variant);
        const outcomes = rows.map((r) => {
          const ep = episodes.find((e) => e.case.episodeId === r.episodeId);
          return ep ? outcomeFor(r, ep, h.seconds) : null;
        }).filter((x): x is NonNullable<typeof x> => x != null);
        const decided = outcomes.filter((x) => x.outcome === "tp1" || x.outcome === "tp2" || x.outcome === "sl");
        const wins = decided.filter((x) => x.outcome === "tp1" || x.outcome === "tp2").length;
        return {
          variant,
          candidates: outcomes.length,
          dataComplete: outcomes.filter((x) => x.complete).length,
          openAtHorizon: outcomes.filter((x) => x.outcome === "open").length,
          tp1: outcomes.filter((x) => x.outcome === "tp1").length,
          tp2: outcomes.filter((x) => x.outcome === "tp2").length,
          sl: outcomes.filter((x) => x.outcome === "sl").length,
          decided: decided.length,
          successPct: decided.length ? (wins / decided.length) * 100 : null,
          meanOutcomeR: mean(decided.map((x) => x.rr).filter((x): x is number => x != null)),
          meanMfeR: mean(outcomes.map((x) => x.mfeR).filter((x): x is number => x != null)),
          meanMaeR: mean(outcomes.map((x) => x.maeR).filter((x): x is number => x != null)),
        };
      }),
    })),
    rule: "Comparación de horizonte sobre la misma señal candidata y la misma cinta 15M. Un TP/SL se cuenta en cuanto se observa, aunque el horizonte completo aún no haya terminado. 6H representa intradía; 1D/2D/3D representan mantener hasta ese horizonte. Los casos sin toque y sin cinta completa quedan pendientes.",
  };
}
