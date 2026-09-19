-- DEV storage bookkeeping for Aiven + Cloudflare R2.
-- Operational only: manifest, checkpoints, optional job rows.
-- No scientific / discovery / V1 tables.

create table if not exists storage_manifest (
  object_key     text not null,
  asset_id       text not null,
  tf             text not null,
  day            date not null,
  content_sha256 text not null,
  byte_size      bigint not null check (byte_size >= 0),
  row_count      bigint not null check (row_count >= 0),
  backend        text not null check (backend in ('r2', 'pg')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (object_key)
);

create index if not exists storage_manifest_asset_tf_day_idx
  on storage_manifest (asset_id, tf, day);

create table if not exists storage_checkpoints (
  job_id      text not null,
  phase       text not null,
  cursor_json jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
    check (status in ('pending', 'running', 'paused', 'done', 'failed')),
  updated_at  timestamptz not null default now(),
  primary key (job_id, phase)
);

create table if not exists storage_job (
  job_id       text primary key,
  kind         text not null,
  source_label text,
  target_label text,
  mode         text not null default 'plan'
    check (mode in ('plan', 'dry-run', 'write')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  notes        text
);
