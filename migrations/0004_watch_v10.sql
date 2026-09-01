-- Atalaya 1.0 capas externas: notify retry, freeze, desenlace.
-- El motor V1 no vive aquí.

alter table signal_events
  add column if not exists notify_status text not null default 'pending',
  add column if not exists notify_attempts integer not null default 0,
  add column if not exists notify_last_error text,
  add column if not exists notify_claimed_at timestamptz,
  add column if not exists notified_at timestamptz;

update signal_events
   set notify_status = 'sent',
       notified_at = coalesce(notified_at, at)
 where notified = true
   and notify_status = 'pending';

alter table signal_episodes
  add column if not exists episode_freeze jsonb;

create table if not exists signal_outcomes (
  episode_id      text primary key references signal_episodes (episode_id),
  rule            text not null,
  outcome         text not null,
  first_touch     text,
  first_touch_at  timestamptz,
  exit_at         timestamptz,
  mfe             double precision,
  mae             double precision,
  evaluated_at    timestamptz not null,
  details         jsonb
);
