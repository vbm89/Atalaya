-- Vigilancia 24/7 (fases 1–3). Unowned market-analysis rows — no user_id.
-- El motor V1 no vive aquí: solo el resultado de cada cierre 15M.

create table if not exists watch_evals (
  slot          bigint primary key,
  started_at    timestamptz not null default now(),
  ran_at        timestamptz not null default now(),
  status        text not null check (status in ('pending', 'ok', 'failed', 'lag')),
  error         text,
  duration_ms   integer,
  retry_count   integer not null default 0,
  assets        jsonb not null default '[]'::jsonb
);

create table if not exists watch_snapshots (
  asset_id      text primary key check (asset_id in ('XAUUSD', 'BTCUSD', 'US100', 'WTI')),
  state         text not null,
  setup         jsonb,
  wait_reason   text,
  evaluated_at  timestamptz not null,
  slot          bigint not null,
  episode_id    text
);

create table if not exists signal_episodes (
  episode_id     text primary key,
  asset_id       text not null check (asset_id in ('XAUUSD', 'BTCUSD', 'US100', 'WTI')),
  direction      text not null,
  kind           text not null,
  zone_low       double precision not null,
  zone_high      double precision not null,
  sl             double precision not null,
  tp1            double precision not null,
  tp2            double precision,
  opened_at      timestamptz not null,
  opened_state   text not null,
  current_state  text not null,
  closed_at      timestamptz,
  levels_key     text not null,
  opened_slot    bigint not null
);

create unique index if not exists signal_episodes_open_asset
  on signal_episodes (asset_id) where closed_at is null;

create index if not exists signal_episodes_asset_opened
  on signal_episodes (asset_id, opened_at desc);

create table if not exists signal_events (
  id            serial primary key,
  episode_id    text not null references signal_episodes (episode_id),
  from_state    text not null,
  to_state      text not null,
  at            timestamptz not null,
  slot          bigint not null,
  notified      boolean not null default false,
  unique (episode_id, slot, from_state, to_state)
);

create index if not exists signal_events_episode
  on signal_events (episode_id, at);
