import type { ShadowCandidateResult, ShadowEpisode } from "./shadow-replay";
import { v1EntrySlot } from "./shadow-replay";

export const SHADOW_FREQUENCY_TARGET = Object.freeze({ minPerDay: 5, maxPerDay: 10 });

export interface ShadowFrequencyDay {
  day: string;
  episodes: number;
  v1Entries: number;
  shadowCandidates: number;
  shadowDecided: number;
  shadowWins: number;
  shadowLosses: number;
  extraCandidates: number;
  extraDecided: number;
  extraWins: number;
  extraLosses: number;
}

export interface ShadowFrequencyReport {
  days: ShadowFrequencyDay[];
  averageCandidatesPerDay: number | null;
  averageExtraCandidatesPerDay: number | null;
  targetMin: number;
  targetMax: number;
  targetReached: boolean;
  limitation: string;
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Research-only density measurement. It never creates live entries and never
 * changes V1. EXTRA means the persisted V1 episode has no ENTRY event.
 */
export function buildShadowFrequencyReport(
  episodes: readonly ShadowEpisode[],
  results: readonly ShadowCandidateResult[],
): ShadowFrequencyReport {
  const byDay = new Map<string, ShadowFrequencyDay>();
  for (const ep of episodes) {
    const day = dayOf(ep.case.openedAtMs);
    const row = byDay.get(day) ?? {
      day, episodes: 0, v1Entries: 0, shadowCandidates: 0, shadowDecided: 0,
      shadowWins: 0, shadowLosses: 0, extraCandidates: 0, extraDecided: 0,
      extraWins: 0, extraLosses: 0,
    };
    row.episodes += 1;
    if (v1EntrySlot(ep) != null) row.v1Entries += 1;
    byDay.set(day, row);
  }

  for (const r of results) {
    const ep = episodes.find((e) => e.case.episodeId === r.episodeId);
    if (!ep) continue;
    const row = byDay.get(dayOf(ep.case.openedAtMs));
    if (!row) continue;
    row.shadowCandidates += 1;
    const decided = r.outcome === "tp1" || r.outcome === "tp2" || r.outcome === "sl";
    if (decided) row.shadowDecided += 1;
    const win = r.outcome === "tp1" || r.outcome === "tp2";
    const loss = r.outcome === "sl";
    if (win) row.shadowWins += 1;
    if (loss) row.shadowLosses += 1;
    if (v1EntrySlot(ep) == null) {
      row.extraCandidates += 1;
      if (decided) row.extraDecided += 1;
      if (win) row.extraWins += 1;
      if (loss) row.extraLosses += 1;
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const avg = days.length ? days.reduce((s, d) => s + d.shadowCandidates, 0) / days.length : null;
  const avgExtra = days.length ? days.reduce((s, d) => s + d.extraCandidates, 0) / days.length : null;
  return {
    days,
    averageCandidatesPerDay: avg,
    averageExtraCandidatesPerDay: avgExtra,
    targetMin: SHADOW_FREQUENCY_TARGET.minPerDay,
    targetMax: SHADOW_FREQUENCY_TARGET.maxPerDay,
    targetReached: avg != null && avg >= SHADOW_FREQUENCY_TARGET.minPerDay,
    limitation: "La densidad está limitada al universo de episodios V1 persistidos; no se usa para autorizar operaciones ni para inventar oportunidades fuera de ese universo.",
  };
}
