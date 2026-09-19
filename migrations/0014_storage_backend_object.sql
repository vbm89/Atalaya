-- Widen storage_manifest.backend to allow S3-compatible object storage (B2).
-- Keep legacy 'r2' for existing rows. Research/DEV only — do not apply against
-- Aiven as part of automated validation; operators apply when ready.
-- Required before writing backend='s3' manifest rows on Aiven.

alter table storage_manifest drop constraint if exists storage_manifest_backend_check;

alter table storage_manifest
  add constraint storage_manifest_backend_check
  check (backend in ('r2', 's3', 'pg'));
