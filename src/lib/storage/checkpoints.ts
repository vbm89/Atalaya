/**
 * storage_checkpoints read/write via SqlQuery-like interface.
 */
import type { SqlQuery } from "../watch/store";
import type { StorageCheckpoint, StorageCheckpointStatus } from "./types";

export function serializeCursor(cursor: Record<string, unknown>): string {
  return JSON.stringify(cursor ?? {});
}

export function parseCursor(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function iso(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return undefined;
}

export async function getCheckpoint(
  sql: SqlQuery,
  jobId: string,
  phase: string,
): Promise<StorageCheckpoint | null> {
  const rows = await sql.query<{
    job_id: string;
    phase: string;
    cursor_json: unknown;
    status: string;
    updated_at: unknown;
  }>(
    `select job_id, phase, cursor_json, status, updated_at
     from storage_checkpoints
     where job_id = $1 and phase = $2
     limit 1`,
    [jobId, phase],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    jobId: r.job_id,
    phase: r.phase,
    cursor: parseCursor(r.cursor_json),
    status: r.status as StorageCheckpointStatus,
    updatedAt: iso(r.updated_at),
  };
}

export async function upsertCheckpoint(
  sql: SqlQuery,
  cp: {
    jobId: string;
    phase: string;
    cursor: Record<string, unknown>;
    status: StorageCheckpointStatus;
  },
): Promise<void> {
  await sql.query(
    `insert into storage_checkpoints (job_id, phase, cursor_json, status, updated_at)
     values ($1, $2, $3::jsonb, $4, now())
     on conflict (job_id, phase) do update set
       cursor_json = excluded.cursor_json,
       status = excluded.status,
       updated_at = now()`,
    [cp.jobId, cp.phase, serializeCursor(cp.cursor), cp.status],
  );
}

export async function listCheckpoints(
  sql: SqlQuery,
  jobId: string,
): Promise<StorageCheckpoint[]> {
  const rows = await sql.query<{
    job_id: string;
    phase: string;
    cursor_json: unknown;
    status: string;
    updated_at: unknown;
  }>(
    `select job_id, phase, cursor_json, status, updated_at
     from storage_checkpoints
     where job_id = $1
     order by phase
     limit 500`,
    [jobId],
  );
  return rows.map((r) => ({
    jobId: r.job_id,
    phase: r.phase,
    cursor: parseCursor(r.cursor_json),
    status: r.status as StorageCheckpointStatus,
    updatedAt: iso(r.updated_at),
  }));
}
