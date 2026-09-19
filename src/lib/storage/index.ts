/** Public exports for DEV storage (Aiven + S3-compatible object storage / B2). */

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

export {
  ObjectStorageAdapter,
  createObjectStorageAdapter,
  ObjectStorageAdapter as S3Adapter,
  createObjectStorageAdapter as createS3Adapter,
  type ObjectStorageConfig,
  type ObjectStorageObjectMeta,
  type ObjectStoragePublicConfig,
  type ObjectStorageEnvName,
  type ObjectStorageAdapterOptions,
  type ObjectStorageClientFactory,
  type ObjectStorageS3Client,
} from "./s3-adapter";

/** R2-named exports are aliases for S3-compatible object storage (Backblaze B2). */
export {
  ObjectStorageAdapter as R2Adapter,
  createObjectStorageAdapter as createR2Adapter,
  type ObjectStorageConfig as R2AdapterConfig,
  type ObjectStorageObjectMeta as R2ObjectMeta,
} from "./s3-adapter";

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
  type JsonlObjectStore,
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
