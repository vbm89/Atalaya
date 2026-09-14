create table if not exists discovery_lab_cache (
  cache_key text primary key,
  cursor_fingerprint text not null,
  generated_at timestamptz not null default now(),
  report jsonb not null
);
