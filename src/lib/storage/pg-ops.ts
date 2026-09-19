/**
 * Postgres helpers for DEV storage.
 * createPgPool(url) with max:1; paginated discovery_bars reads only.
 * NEVER SELECT ... FROM discovery_bars without WHERE + LIMIT / cursor.
 */
import pg from "pg";
import type { ArchiveBar, LoadDiscoveryBarsPageArgs } from "./types";
import type { SqlQuery } from "../watch/store";

const { Pool } = pg;

export interface PgPoolHandle {
  pool: pg.Pool;
  sql: SqlQuery;
  end: () => Promise<void>;
}

export function createPgPool(url: string): PgPoolHandle {
  if (!url || !String(url).trim()) {
    throw new Error("createPgPool: connection URL is required");
  }
  const pool = new Pool({
    connectionString: url,
    max: 1,
  });
  const sql: SqlQuery = {
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    },
    transaction: async <T>(fn: (tx: SqlQuery) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: SqlQuery = {
          query: async <R = Record<string, unknown>>(text: string, params: unknown[] = []) => {
            const res = await client.query(text, params);
            return res.rows as R[];
          },
        };
        try {
          const out = await fn(tx);
          await client.query("COMMIT");
          return out;
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* ignore */
          }
          throw err;
        }
      } finally {
        client.release();
      }
    },
  };
  return {
    pool,
    sql,
    end: async () => {
      await pool.end();
    },
  };
}

/**
 * Build the parameterized SQL for a paginated discovery_bars page.
 * Exported for tests — always includes WHERE (asset, tf, cursor) + LIMIT.
 */
export function buildLoadDiscoveryBarsPageSql(args: LoadDiscoveryBarsPageArgs): {
  text: string;
  params: unknown[];
} {
  const limit = Math.max(1, Math.min(Math.floor(args.limit), 10_000));
  const afterT = Number(args.afterT);
  if (!Number.isFinite(afterT)) {
    throw new Error("loadDiscoveryBarsPage: afterT must be a finite number");
  }
  if (!args.assetId || !args.tf) {
    throw new Error("loadDiscoveryBarsPage: assetId and tf are required");
  }
  // Bound every read: asset + tf + cursor + hard LIMIT. No bare table scans.
  const text = `select asset_id, tf, t, o, h, l, c, v, source
     from discovery_bars
     where asset_id = $1 and tf = $2 and t > $3
     order by t asc
     limit $4`;
  return { text, params: [args.assetId, args.tf, afterT, limit] };
}

export async function loadDiscoveryBarsPage(
  sql: SqlQuery,
  args: LoadDiscoveryBarsPageArgs,
): Promise<ArchiveBar[]> {
  const { text, params } = buildLoadDiscoveryBarsPageSql(args);
  const rows = await sql.query<{
    asset_id: string;
    tf: string;
    t: number | string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number | null;
    source: string;
  }>(text, params);
  return rows.map((r) => ({
    assetId: r.asset_id,
    tf: r.tf,
    t: typeof r.t === "string" ? Number(r.t) : Number(r.t),
    o: Number(r.o),
    h: Number(r.h),
    l: Number(r.l),
    c: Number(r.c),
    v: r.v == null ? null : Number(r.v),
    source: r.source,
  }));
}

/** Count bars for one asset/tf (bounded WHERE; no full-table scan intent). */
export async function countDiscoveryBars(
  sql: SqlQuery,
  assetId: string,
  tf: string,
): Promise<number> {
  const rows = await sql.query<{ c: number | string }>(
    `select count(*)::bigint as c from discovery_bars where asset_id = $1 and tf = $2`,
    [assetId, tf],
  );
  const c = rows[0]?.c;
  return typeof c === "string" ? Number(c) : Number(c ?? 0);
}

export async function upsertStorageManifest(
  sql: SqlQuery,
  entry: {
    objectKey: string;
    assetId: string;
    tf: string;
    day: string;
    contentSha256: string;
    byteSize: number;
    rowCount: number;
    backend: "r2" | "s3" | "pg";
  },
): Promise<void> {
  await sql.query(
    `insert into storage_manifest
       (object_key, asset_id, tf, day, content_sha256, byte_size, row_count, backend, created_at, updated_at)
     values ($1, $2, $3, $4::date, $5, $6, $7, $8, now(), now())
     on conflict (object_key) do update set
       content_sha256 = excluded.content_sha256,
       byte_size = excluded.byte_size,
       row_count = excluded.row_count,
       backend = excluded.backend,
       updated_at = now()`,
    [
      entry.objectKey,
      entry.assetId,
      entry.tf,
      entry.day,
      entry.contentSha256,
      entry.byteSize,
      entry.rowCount,
      entry.backend,
    ],
  );
}
