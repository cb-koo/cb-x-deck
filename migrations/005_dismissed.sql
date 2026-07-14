-- 버림(dismiss): 워크스페이스 단위로 벤치마크 무관 트윗을 숨김. 저장(candidate)=양성, 버림=음성 신호.
create table if not exists dismissed_tweet (
  workspace_id uuid not null references workspace(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  dismissed_by uuid references member(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  primary key (workspace_id, tweet_id)
);
