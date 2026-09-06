create table if not exists shadow_replay_reports (
  id bigserial primary key,
  methodology_version text not null,
  generated_at timestamptz not null,
  episodes_analyzed integer not null,
  episodes_with_15m_tape integer not null,
  episodes_with_gaps integer not null,
  extra_test_n integer not null default 0,
  evidence_label text not null,
  report jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists shadow_replay_reports_generated_idx
  on shadow_replay_reports (generated_at desc);
