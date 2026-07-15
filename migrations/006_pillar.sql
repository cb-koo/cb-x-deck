-- Phase 2: 계정 주제(필러) 분석 — 컬럼당 스냅샷 1개 + 트윗별 주제 배정
create table if not exists pillar_analysis (
  column_id uuid primary key references deck_column(id) on delete cascade,
  topics jsonb not null,              -- [{id: string, label: string}]
  sample_size int not null,
  model text,
  analyzed_at timestamptz not null default now()
);

create table if not exists tweet_topic (
  column_id uuid not null references deck_column(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  topic_id text not null,             -- pillar_analysis.topics[].id 참조(soft)
  primary key (column_id, tweet_id)
);
