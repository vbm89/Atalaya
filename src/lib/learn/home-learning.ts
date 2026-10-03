/**
 * Lectura descriptiva del journal PAPER ya guardado.
 * No decide, no filtra y no reescribe ninguna señal.
 */

export const LEARNING_MFE_MIN = 30;
export const LEARNING_SETUP_MIN = 50;
export const LEARNING_HYPOTHESIS_MIN = 40;
export const LEARNING_SERIOUS_EPISODES = 80;

export interface LearningRow {
  id: string;
  timestamp: number;
  asset: string;
  direction: string;
  result: string;
  resultR: number | null;
  mfeR: number | null;
  maeR: number | null;
  mfeBeforeExitR: number | null;
  episodeId: string | null;
  setup: string | null;
  pathRecorded: boolean;
}

export interface LearningSummary {
  complete: number;
  min: number;
  enough: boolean;
  tp: number | null;
  sl: number | null;
  meanMfeR: number | null;
  meanMaeR: number | null;
  slReachedHalf: number | null;
  slTotal: number | null;
  slReachedPct: number | null;
  slMissedPct: number | null;
  netR: number | null;
  days: number | null;
}

export interface EpisodeView {
  episodeId: string;
  asset: string;
  direction: string;
  setup: string;
  signals: number;
  result: string;
  resultR: number | null;
  mfeR: number | null;
  maeR: number | null;
}

export interface EpisodeSummary {
  episodes: number;
  repeatedSignals: number;
  withoutEpisodeId: number;
  rows: EpisodeView[];
}

export interface HypothesisRow {
  setup: string;
  episodes: number;
  min: number;
  netR: number | null;
  enough: boolean;
  label: string;
}

const MADRID_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function secondsOf(value: unknown): number | null {
  if (!finite(value) || value <= 0) return null;
  return value > 1e12 ? value / 1000 : value;
}

export function learningRowsFrom(input: unknown): LearningRow[] {
  if (!Array.isArray(input)) return [];
  const rows: LearningRow[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = text(row.id) ?? text(row.signalId);
    const timestamp = secondsOf(row.timestamp);
    if (!id || timestamp == null) continue;
    rows.push({
      id,
      timestamp,
      asset: text(row.asset) ?? "—",
      direction: text(row.direction) ?? "—",
      result: text(row.result) ?? "ABIERTA",
      resultR: finite(row.resultR) ? row.resultR : null,
      mfeR: finite(row.mfeR) ? row.mfeR : null,
      maeR: finite(row.maeR) ? row.maeR : null,
      mfeBeforeExitR: finite(row.mfeBeforeExitR) ? row.mfeBeforeExitR : null,
      episodeId: text(row.episodeId),
      setup: text(row.setup),
      pathRecorded: row.pathRecorded === true,
    });
  }
  return rows;
}

export function hasCompleteTelemetry(row: LearningRow): boolean {
  return (
    (row.result === "SL" || row.result === "TP") &&
    row.pathRecorded &&
    row.resultR != null &&
    row.mfeR != null &&
    row.maeR != null
  );
}

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function madridDay(seconds: number): string {
  return MADRID_DAY.format(new Date(seconds * 1000));
}

export function summarizeLearning(rows: readonly LearningRow[]): LearningSummary {
  const complete = rows.filter(hasCompleteTelemetry);
  const enough = complete.length >= LEARNING_MFE_MIN;
  const sl = complete.filter((row) => row.result === "SL");
  const reached = sl.filter((row) => row.mfeBeforeExitR != null && row.mfeBeforeExitR >= 0.5).length;
  const days = new Set(complete.map((row) => madridDay(row.timestamp))).size;
  return {
    complete: complete.length,
    min: LEARNING_MFE_MIN,
    enough,
    tp: complete.length ? complete.filter((row) => row.result === "TP").length : null,
    sl: complete.length ? sl.length : null,
    meanMfeR: enough ? mean(complete.map((row) => row.mfeR!)) : null,
    meanMaeR: enough ? mean(complete.map((row) => row.maeR!)) : null,
    slReachedHalf: enough ? reached : null,
    slTotal: enough ? sl.length : null,
    slReachedPct: enough && sl.length ? Math.round((reached / sl.length) * 100) : null,
    slMissedPct: enough && sl.length ? Math.round(((sl.length - reached) / sl.length) * 100) : null,
    netR: enough ? complete.reduce((sum, row) => sum + row.resultR!, 0) : null,
    days: complete.length ? days : null,
  };
}

export function entryHint(summary: LearningSummary): string {
  if (!summary.enough || summary.slMissedPct == null || summary.slReachedPct == null || summary.slTotal == null) {
    return "Evidencia insuficiente";
  }
  return `Indicio: ${summary.slMissedPct}% de los SL no alcanzaron +0,5R antes del cierre (${summary.slReachedPct}% sí, ${summary.slTotal} SL). Señal de investigación, no una regla.`;
}

function byTime(rows: readonly LearningRow[]): LearningRow[] {
  return rows.slice().sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

export function summarizeEpisodes(rows: readonly LearningRow[]): EpisodeSummary {
  const groups = new Map<string, LearningRow[]>();
  let withoutEpisodeId = 0;
  for (const row of rows) {
    if (!row.episodeId) {
      withoutEpisodeId += 1;
      continue;
    }
    const list = groups.get(row.episodeId) ?? [];
    list.push(row);
    groups.set(row.episodeId, list);
  }
  const views: EpisodeView[] = [];
  let repeatedSignals = 0;
  for (const [episodeId, list] of groups) {
    const ordered = byTime(list);
    const first = ordered[0]!;
    repeatedSignals += ordered.length - 1;
    const measured = hasCompleteTelemetry(first) ? first : null;
    views.push({
      episodeId,
      asset: first.asset,
      direction: first.direction,
      setup: first.setup ?? "SIN_SETUP",
      signals: ordered.length,
      result: first.result,
      resultR: first.result === "SL" || first.result === "TP" ? first.resultR : null,
      mfeR: measured?.mfeR ?? null,
      maeR: measured?.maeR ?? null,
    });
  }
  views.sort((a, b) => a.episodeId.localeCompare(b.episodeId));
  return { episodes: views.length, repeatedSignals, withoutEpisodeId, rows: views };
}

export function hypothesisRadar(episodes: EpisodeSummary): HypothesisRow[] {
  const groups = new Map<string, EpisodeView[]>();
  for (const row of episodes.rows) {
    const list = groups.get(row.setup) ?? [];
    list.push(row);
    groups.set(row.setup, list);
  }
  return [...groups.entries()]
    .map(([setup, list]) => {
      const scored = list.filter((row) => row.resultR != null);
      const completeR = scored.length === list.length;
      const enough = list.length >= LEARNING_HYPOTHESIS_MIN && completeR;
      return {
        setup,
        episodes: list.length,
        min: LEARNING_HYPOTHESIS_MIN,
        netR: completeR ? scored.reduce((sum, row) => sum + row.resultR!, 0) : null,
        enough,
        label: enough
          ? "Hipótesis candidata para test OOS"
          : `Evidencia insuficiente: ${list.length} / ${LEARNING_HYPOTHESIS_MIN} episodios mínimos`,
      };
    })
    .sort((a, b) => b.episodes - a.episodes || a.setup.localeCompare(b.setup));
}
