/** Public exports for DEV storage (Aiven + Cloudflare R2). */

export {
  InactiveStorageError,
  type ArchiveBar,
  type JsonlDayArchiveMeta,
  type LoadDiscoveryBarsPageArgs,
  type StorageBackend,
  type StorageCheckpoint,
  type StorageCheckpointStatus,
  type StorageJob,
  type StorageJobMode,
  type StorageManifestEntry,
} from "./types";

export { R2Adapter, createR2Adapter, type R2AdapterConfig, type R2ObjectMeta } from "./r2-adapter";

export {
  JsonlShaWriter,
  barToJsonlLine,
  discoveryDayObjectKey,
  encodeBarsJsonl,
  parseJsonlBars,
  readDiscoveryDayArchive,
  sha256Utf8,
  utcDayBoundsMs,
  utcDayFromT,
  writeDiscoveryDayArchive,
} from "./jsonl-archive";

export {
  getCheckpoint,
  listCheckpoints,
  parseCursor,
  serializeCursor,
  upsertCheckpoint,
} from "./checkpoints";

export {
  buildLoadDiscoveryBarsPageSql,
  countDiscoveryBars,
  createPgPool,
  loadDiscoveryBarsPage,
  upsertStorageManifest,
  type PgPoolHandle,
} from "./pg-ops";

export { createDevStorage, type DevStorage, type DevStorageOptions } from "./dev-storage";
