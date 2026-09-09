create table if not exists shadow_xau_feed_samples (
  id bigserial primary key,
  captured_at timestamptz not null default now(),
  source text not null,
  bid double precision,
  ask double precision,
  mid double precision,
  latency_ms integer
);

create index if not exists shadow_xau_feed_samples_captured_at_idx
  on shadow_xau_feed_samples (captured_at desc);

create index if not exists shadow_xau_feed_samples_source_captured_at_idx
  on shadow_xau_feed_samples (source, captured_at desc);
