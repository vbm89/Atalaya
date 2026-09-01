-- Atalaya memoria de investigación (cinta, archivo M15, SHA, contexto, diario, post-mortem).
-- Capa externa. V1 no lee estas tablas. Append-only: ON CONFLICT DO NOTHING.
-- Claves naturales listas para exportar a object storage (JSONL/Parquet) sin reescribir filas.

-- SHA / versión de cada evaluación 15M. Primera escritura gana.
create table if not exists watch_eval_versions (
  slot         bigint primary key,
  git_sha      text,
  v1_label     text not null default 'V1',
  recorded_at  timestamptz not null
);

-- Archivo continuo M15 de los 4 activos. UTC unix seconds en t.
-- Export futuro: COPY (select * from market_m15 where t >= $from and t < $to)
--   → object storage, particionado por asset_id + día UTC. No se hace ahora.
create table if not exists market_m15 (
  asset_id     text not null check (asset_id in ('XAUUSD', 'BTCUSD', 'US100', 'WTI')),
  t            bigint not null,
  o            double precision not null,
  h            double precision not null,
  l            double precision not null,
  c            double precision not null,
  v            double precision,
  source       text,
  instrument   text,
  ingested_at  timestamptz not null,
  primary key (asset_id, t)
);

create index if not exists market_m15_t_idx on market_m15 (t desc);

-- Cinta por episodio: velas realmente recibidas. No se reescriben.
create table if not exists episode_tape_bars (
  episode_id   text not null references signal_episodes (episode_id),
  tf           text not null check (tf in ('15m', '1h', '4h')),
  t            bigint not null,
  o            double precision not null,
  h            double precision not null,
  l            double precision not null,
  c            double precision not null,
  v            double precision,
  role         text not null check (role in ('lookback', 'forward')),
  ingested_at  timestamptz not null,
  primary key (episode_id, tf, t)
);

create index if not exists episode_tape_bars_episode_tf
  on episode_tape_bars (episode_id, tf, t);

-- Huecos detectados (sin inventar la vela).
create table if not exists episode_tape_gaps (
  episode_id   text not null references signal_episodes (episode_id),
  tf           text not null check (tf in ('15m', '1h', '4h')),
  t            bigint not null,
  role         text not null check (role in ('lookback', 'forward')),
  noted_at     timestamptz not null,
  primary key (episode_id, tf, t)
);

-- Fotografía de contexto. No se actualiza después.
create table if not exists episode_context (
  episode_id     text primary key references signal_episodes (episode_id),
  captured_at    timestamptz not null,
  madrid_date    text,
  madrid_time    text,
  weekday        text,
  session        text,
  calendar       jsonb not null default '[]'::jsonb,
  basis          double precision,
  data_status    text,
  warnings       jsonb,
  feed           jsonb,
  git_sha        text,
  v1_label       text not null default 'V1'
);

-- Diario humano. No altera outcome ni V1.
create table if not exists episode_journal (
  episode_id     text primary key references signal_episodes (episode_id),
  action         text not null check (action in ('took', 'skipped', 'partial')),
  lots           double precision,
  entry_price    double precision,
  exit_price     double precision,
  note           text,
  updated_at     timestamptz not null
);

-- Post-mortem determinista. Primera escritura gana.
create table if not exists episode_postmortem (
  episode_id     text primary key references signal_episodes (episode_id),
  generated_at   timestamptz not null,
  body           jsonb not null
);
