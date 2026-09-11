import type { SqlQuery } from "./store";

export interface V1PeriodStatsRow {
  assetId: string;
  entries: number;
  tp1: number;
  tp2: number;
  sl: number;
  pending: number;
  expired: number;
}

export interface V1PeriodStats {
  from: string;
  to: string;
  entries: number;
  tp1: number;
  tp2: number;
  sl: number;
  pending: number;
  expired: number;
  byAsset: V1PeriodStatsRow[];
}

const ASSETS = ["XAUUSD", "BTCUSD", "US100", "WTI"] as const;

/** ENTRY-only. Prefers details.postEntry (ENTRY clock) over MAP-birth signal_outcomes. */
export const V1_PERIOD_STATS_SQL = `with entries as (
       select distinct on (ev.episode_id)
         ev.episode_id,
         e.asset_id,
         ev.at as entry_at
       from signal_events ev
       join signal_episodes e on e.episode_id = ev.episode_id
       where ev.to_state = 'entry'
         and ev.at >= $1::timestamptz
         and ev.at < $2::timestamptz
       order by ev.episode_id, ev.at asc, ev.id asc
     ),
     outcomes as (
       select o.episode_id,
         coalesce(nullif(o.details->'postEntry'->>'outcome', ''), o.outcome) as outcome
       from signal_outcomes o
       join entries en on en.episode_id = o.episode_id
     )
     select
       en.asset_id,
       count(*)::int as entries,
       count(*) filter (where o.outcome = 'tp1')::int as tp1,
       count(*) filter (where o.outcome = 'tp2')::int as tp2,
       count(*) filter (where o.outcome = 'sl')::int as sl,
       count(*) filter (where o.outcome is null or o.outcome in ('pending', 'none'))::int as pending,
       count(*) filter (where o.outcome = 'expired')::int as expired
     from entries en
     left join outcomes o on o.episode_id = en.episode_id
     group by en.asset_id
     order by en.asset_id`;

export function foldV1PeriodStats(
  rows: readonly Record<string, unknown>[],
  fromIso: string,
  toIso: string,
): V1PeriodStats {
  const map = new Map(rows.map((r) => [String(r.asset_id), r]));
  const byAsset = ASSETS.map((assetId) => {
    const r = map.get(assetId);
    return {
      assetId,
      entries: Number(r?.entries ?? 0),
      tp1: Number(r?.tp1 ?? 0),
      tp2: Number(r?.tp2 ?? 0),
      sl: Number(r?.sl ?? 0),
      pending: Number(r?.pending ?? 0),
      expired: Number(r?.expired ?? 0),
    };
  });

  return {
    from: fromIso,
    to: toIso,
    entries: byAsset.reduce((n, r) => n + r.entries, 0),
    tp1: byAsset.reduce((n, r) => n + r.tp1, 0),
    tp2: byAsset.reduce((n, r) => n + r.tp2, 0),
    sl: byAsset.reduce((n, r) => n + r.sl, 0),
    pending: byAsset.reduce((n, r) => n + r.pending, 0),
    expired: byAsset.reduce((n, r) => n + r.expired, 0),
    byAsset,
  };
}

export async function readV1PeriodStats(sql: SqlQuery, fromIso = "2026-09-01T00:00:00.000Z"): Promise<V1PeriodStats> {
  const toIso = new Date().toISOString();
  const rows = await sql.query<Record<string, unknown>>(V1_PERIOD_STATS_SQL, [fromIso, toIso]);
  return foldV1PeriodStats(rows, fromIso, toIso);
}
