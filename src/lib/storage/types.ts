/** Shared types for DEV storage (Aiven PG + Cloudflare R2). */

export type StorageBackend = "r2" | "pg";

export type StorageCheckpointStatus =
  | "pending"
  | "running"
  | "paused"
  | "done"
  | "failed";

export type StorageJobMode = "plan" | "dry-run" | "write";

/** Minimal OHLC row used for JSONL archive (discovery tape). */
export interface ArchiveBar {
  assetId: string;
  tf: string;
  /** Unix seconds (or ms — callers must be consistent per archive). */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  source?: string;
}

export interface StorageManifestEntry {
  objectKey: string;
  assetId: string;
  tf: string;
  /** UTC calendar day YYYY-MM-DD */
  day: string;
  contentSha256: string;
  byteSize: number;
  rowCount: number;
  backend: StorageBackend;
  createdAt?: string;
  updatedAt?: string;
}

export interface StorageCheckpoint {
  jobId: string;
  phase: string;
  cursor: Record<string, unknown>;
  status: StorageCheckpointStatus;
  updatedAt?: string;
}

export interface StorageJob {
  jobId: string;
  kind: string;
  sourceLabel: string | null;
  targetLabel: string | null;
  mode: StorageJobMode;
  startedAt?: string;
  finishedAt?: string | null;
  notes?: string | null;
}

export interface LoadDiscoveryBarsPageArgs {
  assetId: string;
  tf: string;
  /** Exclusive lower bound on bar time `t`. Use 0 / negative to start. */
  afterT: number;
  limit: number;
}

export interface JsonlDayArchiveMeta {
  objectKey: string;
  assetId: string;
  tf: string;
  day: string;
  contentSha256: string;
  byteSize: number;
  rowCount: number;
}

/** Thrown when R2 (or other) storage is configured inactive / missing creds. */
export class InactiveStorageError extends Error {
  readonly code = "INACTIVE_STORAGE" as const;
  constructor(message = "Storage backend is inactive (required env vars missing)") {
    super(message);
    this.name = "InactiveStorageError";
  }
}
