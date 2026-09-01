-- Fase 4–5: suscripciones Web Push y config VAPID. Sin secretos de broker.

create table if not exists push_subscriptions (
  endpoint      text primary key,
  p256dh        text not null,
  auth          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  user_agent    text,
  last_error    text,
  disabled_at   timestamptz
);

create index if not exists push_subscriptions_active
  on push_subscriptions (created_at)
  where disabled_at is null;

create table if not exists watch_config (
  key    text primary key,
  value  text not null
);
