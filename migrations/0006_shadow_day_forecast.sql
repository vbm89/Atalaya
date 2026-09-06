create table if not exists shadow_day_forecasts (
  id bigserial primary key,
  forecast_date date not null,
  asset_id text not null,
  generated_at timestamptz not null,
  direction text not null,
  confidence integer not null,
  bullish_score integer not null,
  bearish_score integer not null,
  reasons jsonb not null default '[]'::jsonb,
  snapshot jsonb not null,
  reference_price double precision not null,
  last_price double precision not null,
  mfe_pct double precision not null default 0,
  mae_pct double precision not null default 0,
  last_seen_at timestamptz not null,
  status text not null default 'open',
  outcome text,
  outcome_at timestamptz,
  autopsy jsonb,
  unique (forecast_date, asset_id)
);

create index if not exists shadow_day_forecasts_asset_date_idx
  on shadow_day_forecasts (asset_id, forecast_date desc);
