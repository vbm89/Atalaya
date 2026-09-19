/**
 * Facade wiring PG ops + R2 + manifest for DEV storage.
 */
import { createR2Adapter, type R2Adapter } from "./r2-adapter";
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
  r2: R2Adapter;
  pg: PgPoolHandle | null;
  sql: SqlQuery | null;
  close: () => Promise<void>;
  loadDiscoveryBarsPage: (args: LoadDiscoveryBarsPageArgs) => Promise<ArchiveBar[]>;
  archiveDayToR2: (args: {
    assetId: string;
    tf: string;
    day: string;
    bars: readonly ArchiveBar[];
    recordManifest?: boolean;
  }) => Promise<JsonlDayArchiveMeta>;
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
  const r2 = createR2Adapter(env);
  const pg = opts.databaseUrl ? createPgPool(opts.databaseUrl) : null;
  const sql = pg?.sql ?? null;

  return {
    r2,
    pg,
    sql,
    close: async () => {
      r2.destroy();
      if (pg) await pg.end();
    },
    loadDiscoveryBarsPage: async (args) => {
      if (!sql) throw new Error("DevStorage: no databaseUrl configured for PG reads");
      return loadDiscoveryBarsPage(sql, args);
    },
    archiveDayToR2: async ({ assetId, tf, day, bars, recordManifest = true }) => {
      const meta = await writeDiscoveryDayArchive(r2, { assetId, tf, day, bars });
      if (recordManifest && sql) {
        await upsertStorageManifest(sql, {
          objectKey: meta.objectKey,
          assetId: meta.assetId,
          tf: meta.tf,
          day: meta.day,
          contentSha256: meta.contentSha256,
          byteSize: meta.byteSize,
          rowCount: meta.rowCount,
          backend: "r2",
        });
      }
      return meta;
    },
    readDayFromR2: (assetId, tf, day) => readDiscoveryDayArchive(r2, assetId, tf, day),
    objectKeyForDay: discoveryDayObjectKey,
    encodeBarsJsonl,
    utcDayFromT,
    getCheckpoint,
    upsertCheckpoint,
  };
}
