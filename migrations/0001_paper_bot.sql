-- Paper bot durable state. Additive. Does not touch V1 or existing tables.
create table if not exists paper_bot_state (
  id integer primary key check (id = 1),
  body jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists paper_bot_decision (
  asset text not null,
  timeframe text not null default '15m',
  last_bar_t bigint not null,
  mode text not null,
  decision text not null,
  reason text not null,
  provider text,
  data_status text not null,
  evaluated_at bigint not null,
  price double precision,
  entry_px double precision,
  stop_px double precision,
  target_px double precision,
  rr double precision,
  setup text,
  primary key (asset, timeframe, last_bar_t, mode)
);

create table if not exists paper_bot_signal (
  signal_id text primary key,
  asset text not null,
  timeframe text not null,
  last_bar_t bigint not null,
  direction text not null,
  body jsonb not null,
  result text not null,
  unique (asset, timeframe, last_bar_t, direction)
);
