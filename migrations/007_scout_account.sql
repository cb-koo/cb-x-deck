-- 섭외 후보(스카우트) — 리포스터 등에서 발견한 시딩 후보 계정, 워크스페이스 단위
create table if not exists scout_account (
  workspace_id uuid not null references workspace(id) on delete cascade,
  handle text not null,
  name text,
  avatar_url text,
  bio text,
  followers int,
  verified boolean not null default false,
  source_tweet_id text references tweet(tweet_id) on delete set null,  -- 발견 출처 트윗
  saved_by uuid references member(id) on delete set null,
  saved_at timestamptz not null default now(),
  primary key (workspace_id, handle)
);
