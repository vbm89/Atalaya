-- Shadow Pattern Discovery archive. Independent of V1 episodes and of K1.
-- Native timeframes only. Gaps are recorded, never filled.

create table if not exists discovery_bars (
  asset_id    text not null check (asset_id in ('XAUUSD', 'BTCUSD', 'US100', 'WTI')),
  tf          text not null check (tf in ('1m', '5m', '15m', '30m', '1h', '4h')),
  t           bigint not null,
  o           double precision not null,
  h           double precision not null,
  l           double precision not null,
  c           double precision not null,
  v           double precision,
  source      text not null,
  ingested_at timestamptz not null default now(),
  primary key (asset_id, tf, t)
);

create index if not exists discovery_bars_tf_t_idx on discovery_bars (tf, t desc);

create table if not exists discovery_gaps (
  asset_id  text not null,
  tf        text not null,
  from_t    bigint not null,
  to_t      bigint not null,
  missing   int not null,
  primary key (asset_id, tf, from_t)
);

create table if not exists discovery_journal (
  id            bigserial primary key,
  explored_at   timestamptz not null default now(),
  universe      text not null,
  primitives    text[] not null default '{}',
  families      text[] not null default '{}',
  variants      text[] not null default '{}',
  discarded     text[] not null default '{}',
  discard_reason text,
  candidates    text[] not null default '{}',
  outcome_consulted boolean not null default false,
  code_version  text,
  notes         text
);
