/**
 * Facade wiring PG ops + S3-compatible object storage (B2) + manifest for DEV storage.
 */
import {
  createObjectStorageAdapter,
  type ObjectStorageAdapter,
} from "./s3-adapter";
import {
  createPgPool,
  loadDiscoveryBarsPage,
  upsertStorageManifest,
  type PgPoolHandle,
} from "./pg-ops";
import {
  discoveryDayObjectKey,
  encodeBarsJsonl,
  readDiscoveryDayArchive,
  utcDayFromT,
  writeDiscoveryDayArchive,
} from "./jsonl-archive";
import { getCheckpoint, upsertCheckpoint } from "./checkpoints";
import type { ArchiveBar, JsonlDayArchiveMeta, LoadDiscoveryBarsPageArgs } from "./types";
import type { SqlQuery } from "../watch/store";

export interface DevStorageOptions {
  /** Target / ops database URL (Aiven). Optional until write path is used. */
  databaseUrl?: string;
  env?: NodeJS.ProcessEnv;
}

export interface DevStorage {
  /** Primary S3-compatible object storage adapter (B2). */
  objectStorage: ObjectStorageAdapter;
  /** Alias of objectStorage for legacy callers. */
  r2: ObjectStorageAdapter;
  pg: PgPoolHandle | null;
  sql: SqlQuery | null;
  close: () => Promise<void>;
  loadDiscoveryBarsPage: (args: LoadDiscoveryBarsPageArgs) => Promise<ArchiveBar[]>;
  archiveDayToObjectStorage: (args: {
    assetId: string;
    tf: string;
    day: string;
    bars: readonly ArchiveBar[];
    recordManifest?: boolean;
  }) => Promise<JsonlDayArchiveMeta>;
  /** Alias of archiveDayToObjectStorage. */
  archiveDayToR2: (args: {
    assetId: string;
    tf: string;
    day: string;
    bars: readonly ArchiveBar[];
    recordManifest?: boolean;
  }) => Promise<JsonlDayArchiveMeta>;
  readDayFromObjectStorage: (
    assetId: string,
    tf: string,
    day: string,
  ) => Promise<{ meta: JsonlDayArchiveMeta; bars: ArchiveBar[] }>;
  /** Alias of readDayFromObjectStorage. */
  readDayFromR2: (
    assetId: string,
    tf: string,
    day: string,
  ) => Promise<{ meta: JsonlDayArchiveMeta; bars: ArchiveBar[] }>;
  objectKeyForDay: typeof discoveryDayObjectKey;
  encodeBarsJsonl: typeof encodeBarsJsonl;
  utcDayFromT: typeof utcDayFromT;
  getCheckpoint: typeof getCheckpoint;
  upsertCheckpoint: typeof upsertCheckpoint;
}

export function createDevStorage(opts: DevStorageOptions = {}): DevStorage {
  const env = opts.env ?? process.env;
  const objectStorage = createObjectStorageAdapter(env);
  const pg = opts.databaseUrl ? createPgPool(opts.databaseUrl) : null;
  const sql = pg?.sql ?? null;

  const archiveDayToObjectStorage = async ({
    assetId,
    tf,
    day,
    bars,
    recordManifest = true,
  }: {
    assetId: string;
    tf: string;
    day: string;
    bars: readonly ArchiveBar[];
    recordManifest?: boolean;
  }) => {
    const meta = await writeDiscoveryDayArchive(objectStorage, { assetId, tf, day, bars });
    if (recordManifest && sql) {
      await upsertStorageManifest(sql, {
        objectKey: meta.objectKey,
        assetId: meta.assetId,
        tf: meta.tf,
        day: meta.day,
        contentSha256: meta.contentSha256,
        byteSize: meta.byteSize,
        rowCount: meta.rowCount,
        backend: "s3",
      });
    }
    return meta;
  };

  const readDayFromObjectStorage = (assetId: string, tf: string, day: string) =>
    readDiscoveryDayArchive(objectStorage, assetId, tf, day);

  return {
    objectStorage,
    r2: objectStorage,
    pg,
    sql,
    close: async () => {
      objectStorage.destroy();
      if (pg) await pg.end();
    },
    loadDiscoveryBarsPage: async (args) => {
      if (!sql) throw new Error("DevStorage: no databaseUrl configured for PG reads");
      return loadDiscoveryBarsPage(sql, args);
    },
    archiveDayToObjectStorage,
    archiveDayToR2: archiveDayToObjectStorage,
    readDayFromObjectStorage,
    readDayFromR2: readDayFromObjectStorage,
    objectKeyForDay: discoveryDayObjectKey,
    encodeBarsJsonl,
    utcDayFromT,
    getCheckpoint,
    upsertCheckpoint,
  };
}
