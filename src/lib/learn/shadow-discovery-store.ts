import type { AssetId } from "../trading/types";
import type { SqlQuery } from "../watch/store";
import { sanitizeBars } from "./shadow-discovery-bars";
import type { DiscoveryBar, DiscoveryInstrumentKind, DiscoveryJournalEntry, DiscoveryTf } from "./shadow-discovery-types";

const CHUNK = 40;

export interface DiscoveryCursor {
  assetId: AssetId;
  tf: DiscoveryTf;
  oldestT: number | null;
  newestT: number | null;
  source: string | null;
  instrument: string | null;
  instrumentKind: DiscoveryInstrumentKind | null;
  exhausted: boolean;
  pages: number;
}

export async function persistDiscoveryBars(sql: SqlQuery, bars: readonly DiscoveryBar[]): Promise<number> {
  const clean = sanitizeBars(bars);
  let n = 0;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const slice = clean.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders = slice.map((b, idx) => {
      const o = idx * 9;
      values.push(b.assetId, b.tf, b.t, b.o, b.h, b.l, b.c, b.v, b.source);
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9}, now())`;
    });
    const rows = await sql.query<{ c: number }>(
      `insert into discovery_bars (asset_id, tf, t, o, h, l, c, v, source, ingested_at)
       values ${placeholders.join(",")}
       on conflict (asset_id, tf, t) do nothing
       returning 1 as c`,
      values,
    );
    n += rows.length;
  }
  return n;
}

export async function loadDiscoveryBars(sql: SqlQuery): Promise<DiscoveryBar[]> {
  const rows = await sql.query<{
    asset_id: string; tf: string; t: number; o: number; h: number; l: number; c: number; v: number | null; source: string;
  }>(`select asset_id, tf, t, o, h, l, c, v, source from discovery_bars order by asset_id, tf, t`);
  return sanitizeBars(rows.map((r) => ({
    assetId: r.asset_id as DiscoveryBar["assetId"],
    tf: r.tf as DiscoveryBar["tf"],
    t: Number(r.t), o: r.o, h: r.h, l: r.l, c: r.c,
    v: r.v == null ? null : Number(r.v),
    source: r.source,
  })));
}

export async function loadDiscoveryCursors(sql: SqlQuery): Promise<DiscoveryCursor[]> {
  const rows = await sql.query<{
    asset_id: string; tf: string; oldest_t: number | null; newest_t: number | null;
    source: string | null; instrument: string | null; instrument_kind: string | null;
    exhausted: boolean; pages: number;
  }>(`select asset_id, tf, oldest_t, newest_t, source, instrument, instrument_kind, exhausted, pages from discovery_ingest_cursor`);
  return rows.map((r) => ({
    assetId: r.asset_id as AssetId,
    tf: r.tf as DiscoveryTf,
    oldestT: r.oldest_t == null ? null : Number(r.oldest_t),
    newestT: r.newest_t == null ? null : Number(r.newest_t),
    source: r.source,
    instrument: r.instrument,
    instrumentKind: (r.instrument_kind as DiscoveryInstrumentKind | null),
    exhausted: Boolean(r.exhausted),
    pages: Number(r.pages) || 0,
  }));
}

export async function upsertDiscoveryCursor(sql: SqlQuery, c: DiscoveryCursor): Promise<void> {
  await sql.query(
    `insert into discovery_ingest_cursor
       (asset_id, tf, oldest_t, newest_t, source, instrument, instrument_kind, exhausted, pages, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     on conflict (asset_id, tf) do update set
       oldest_t = least(discovery_ingest_cursor.oldest_t, excluded.oldest_t),
       newest_t = greatest(discovery_ingest_cursor.newest_t, excluded.newest_t),
       source = excluded.source,
       instrument = excluded.instrument,
       instrument_kind = excluded.instrument_kind,
       exhausted = excluded.exhausted,
       pages = discovery_ingest_cursor.pages + excluded.pages,
       updated_at = now()`,
    [c.assetId, c.tf, c.oldestT, c.newestT, c.source, c.instrument, c.instrumentKind, c.exhausted, c.pages],
  );
}

export async function persistDiscoveryJournal(sql: SqlQuery, entry: DiscoveryJournalEntry): Promise<void> {
  await sql.query(
    `insert into discovery_journal
      (explored_at, universe, primitives, families, variants, discarded, discard_reason, candidates, outcome_consulted, code_version, notes)
     values ($1::timestamptz,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      entry.exploredAt, entry.universe, entry.primitives, entry.families, entry.variants,
      entry.discarded, entry.discardReason, entry.candidates, entry.outcomeConsulted,
      entry.codeVersion, entry.notes,
    ],
  );
}

export async function loadDiscoveryJournal(sql: SqlQuery, limit = 20): Promise<DiscoveryJournalEntry[]> {
  const rows = await sql.query<{
    explored_at: string; universe: string; primitives: string[]; families: string[];
    variants: string[]; discarded: string[]; discard_reason: string | null;
    candidates: string[]; outcome_consulted: boolean; code_version: string; notes: string | null;
  }>(`select explored_at, universe, primitives, families, variants, discarded, discard_reason, candidates, outcome_consulted, code_version, notes
      from discovery_journal order by id desc limit $1`, [limit]);
  return rows.map((r) => ({
    exploredAt: typeof r.explored_at === "string" ? r.explored_at : new Date(r.explored_at).toISOString(),
    universe: r.universe,
    primitives: r.primitives ?? [],
    families: r.families ?? [],
    variants: r.variants ?? [],
    discarded: r.discarded ?? [],
    discardReason: r.discard_reason,
    candidates: r.candidates ?? [],
    outcomeConsulted: Boolean(r.outcome_consulted),
    codeVersion: r.code_version,
    notes: r.notes,
  }));
}
