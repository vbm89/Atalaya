-- Cursor for native historical backfill. One row per asset/tf.
-- exhausted = the provider returned a short page or we hit the storage lookback budget.
-- Never used to fill gaps.

create table if not exists discovery_ingest_cursor (
  asset_id     text not null,
  tf           text not null,
  oldest_t     bigint,
  newest_t     bigint,
  source       text,
  instrument   text,
  instrument_kind text,
  exhausted    boolean not null default false,
  pages        int not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (asset_id, tf)
);
