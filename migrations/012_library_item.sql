-- 012: 팀 보관함 소속(library_item)을 개인 저장(candidate)과 분리. 재실행 안전.
create table if not exists library_item (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  added_by uuid references member(id) on delete set null,
  added_at timestamptz not null default now()
);
create unique index if not exists idx_library_item_ws_tweet on library_item (workspace_id, tweet_id);

-- backfill: candidate가 있는 모든 (workspace, tweet)에 library_item 생성
-- added_by = 가장 먼저 저장한 멤버, added_at = 최소 saved_at
insert into library_item (workspace_id, tweet_id, added_by, added_at)
select distinct on (c.workspace_id, c.tweet_id)
       c.workspace_id, c.tweet_id, c.member_id, c.saved_at
  from candidate c
  order by c.workspace_id, c.tweet_id, c.saved_at asc
on conflict (workspace_id, tweet_id) do nothing;
