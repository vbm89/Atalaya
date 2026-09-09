create table if not exists shadow_intrabar_bars (
  asset_id text not null check (asset_id in ('XAUUSD', 'BTCUSD', 'US100', 'WTI')),
  tf text not null check (tf in ('1m', '5m')),
  t bigint not null,
  o double precision not null,
  h double precision not null,
  l double precision not null,
  c double precision not null,
  v double precision,
  captured_at timestamptz not null default now(),
  primary key (asset_id, tf, t)
);

create index if not exists shadow_intrabar_bars_asset_tf_t_idx
  on shadow_intrabar_bars (asset_id, tf, t desc);
