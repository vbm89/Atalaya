import type { PublicWatchHealth } from "./health";

/** Display string when a diagnostic field cannot be read. Never invent a number. */
export const LAB_UNAVAILABLE = "No disponible";

export interface LabIntegrityCounts {
  episodes: number | null;
  v1Entries: number | null;
  entriesWithTape: number | null;
  tapeGaps: number | null;
  withEntryGates: number | null;
  withoutEntryGates: number | null;
  withPostEntry: number | null;
  withoutPostEntry: number | null;
  technicalOutcomesWithoutEntry: number | null;
  gitSha: string | null;
}

export interface LabIntegrity extends LabIntegrityCounts {
  tick: string;
  persistence: string;
  v1Sha: string;
  lastShadowReplayAt: string | null;
  lastShadowReplayResult: string | null;
  extraTestN: number | null;
  lastReplayInsufficient: boolean | null;
}

export const LAB_COUNTS_SQL = `
select
  (select count(*)::int from signal_episodes) as episodes,
  (select count(*)::int from signal_episodes e
    where exists (
      select 1 from signal_events ev
      where ev.episode_id = e.episode_id and ev.to_state = 'entry'
    )) as v1_entries,
  (select count(*)::int from signal_episodes e
    where exists (
      select 1 from signal_events ev
      where ev.episode_id = e.episode_id and ev.to_state = 'entry'
    )
    and exists (
      select 1 from episode_tape_bars t
      where t.episode_id = e.episode_id and t.tf = '15m'
    )) as entries_with_tape,
  (select count(*)::int from episode_tape_gaps) as tape_gaps,
  (select count(*)::int from signal_episodes
    where episode_freeze is not null
      and jsonb_typeof(episode_freeze->'entryGates') = 'object') as with_entry_gates,
  (select count(*)::int from signal_episodes
    where episode_freeze is null
       or jsonb_typeof(episode_freeze->'entryGates') is distinct from 'object') as without_entry_gates,
  (select count(*)::int from signal_outcomes
    where jsonb_typeof(details->'postEntry') = 'object') as with_post_entry,
  (select count(*)::int from signal_episodes e
    where not exists (
      select 1 from signal_outcomes o
      where o.episode_id = e.episode_id
        and jsonb_typeof(o.details->'postEntry') = 'object'
    )) as without_post_entry,
  (select count(*)::int from signal_outcomes o
    where o.outcome in ('sl', 'tp1', 'tp2')
      and not exists (
        select 1 from signal_events ev
        where ev.episode_id = o.episode_id and ev.to_state = 'entry'
      )) as technical_without_entry,
  (select git_sha from watch_eval_versions order by slot desc limit 1) as git_sha
`;

export function labUnavailable(persistence: "OK" | "error" | typeof LAB_UNAVAILABLE = LAB_UNAVAILABLE): LabIntegrity {
  return {
    tick: LAB_UNAVAILABLE,
    persistence,
    v1Sha: LAB_UNAVAILABLE,
    episodes: null,
    v1Entries: null,
    entriesWithTape: null,
    tapeGaps: null,
    withEntryGates: null,
    withoutEntryGates: null,
    withPostEntry: null,
    withoutPostEntry: null,
    technicalOutcomesWithoutEntry: null,
    lastShadowReplayAt: null,
    lastShadowReplayResult: null,
    extraTestN: null,
    lastReplayInsufficient: null,
    gitSha: null,
  };
}

export function tickIntegrityLabel(health: Pick<PublicWatchHealth, "lastStatus" | "stale"> | null): string {
  if (!health || health.lastStatus == null || health.lastStatus === "none") return LAB_UNAVAILABLE;
  if (health.lastStatus === "failed") return "error";
  if (health.stale || health.lastStatus === "lag") return "retrasado";
  if (health.lastStatus === "ok") return "OK";
  return LAB_UNAVAILABLE;
}

export function displayLabValue(value: string | number | boolean | null | undefined): string {
  if (value == null || value === "") return LAB_UNAVAILABLE;
  if (typeof value === "boolean") return value ? "sí" : "no";
  return String(value);
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function parseLabCounts(row: Record<string, unknown> | null | undefined): LabIntegrityCounts {
  if (!row) {
    return {
      episodes: null,
      v1Entries: null,
      entriesWithTape: null,
      tapeGaps: null,
      withEntryGates: null,
      withoutEntryGates: null,
      withPostEntry: null,
      withoutPostEntry: null,
      technicalOutcomesWithoutEntry: null,
      gitSha: null,
    };
  }
  return {
    episodes: intOrNull(row.episodes),
    v1Entries: intOrNull(row.v1_entries),
    entriesWithTape: intOrNull(row.entries_with_tape),
    tapeGaps: intOrNull(row.tape_gaps),
    withEntryGates: intOrNull(row.with_entry_gates),
    withoutEntryGates: intOrNull(row.without_entry_gates),
    withPostEntry: intOrNull(row.with_post_entry),
    withoutPostEntry: intOrNull(row.without_post_entry),
    technicalOutcomesWithoutEntry: intOrNull(row.technical_without_entry),
    gitSha: typeof row.git_sha === "string" && row.git_sha ? row.git_sha : null,
  };
}
