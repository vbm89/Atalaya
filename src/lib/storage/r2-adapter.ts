/**
 * Compatibility layer: R2-named exports are aliases for S3-compatible
 * object storage (Backblaze B2). Credentials use OBJECT_STORAGE_* only —
 * R2_ACCOUNT_ID is no longer required.
 */
export {
  ObjectStorageAdapter as R2Adapter,
  createObjectStorageAdapter as createR2Adapter,
  ObjectStorageAdapter as S3Adapter,
  createObjectStorageAdapter as createS3Adapter,
  ObjectStorageAdapter,
  createObjectStorageAdapter,
  type ObjectStorageConfig as R2AdapterConfig,
  type ObjectStorageObjectMeta as R2ObjectMeta,
  type ObjectStorageConfig,
  type ObjectStorageObjectMeta,
  type ObjectStoragePublicConfig,
  type ObjectStorageEnvName,
  type ObjectStorageAdapterOptions,
  type ObjectStorageClientFactory,
  type ObjectStorageS3Client,
} from "./s3-adapter";
