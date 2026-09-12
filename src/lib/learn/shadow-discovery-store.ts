import type { SqlQuery } from "../watch/store";
import { sanitizeBars } from "./shadow-discovery-bars";
import type { DiscoveryBar, DiscoveryJournalEntry } from "./shadow-discovery-types";

const CHUNK = 40;

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
