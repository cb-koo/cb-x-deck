-- v1.5 UX 계층화: 워크스페이스(클라이언트)·멤버·멤버별 봤음. 재실행 안전(idempotent).
create table if not exists workspace (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists member (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#1d9bf0',
  created_at timestamptz not null default now()
);

create table if not exists tweet_seen (
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  member_id uuid not null references member(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (tweet_id, member_id)
);
create index if not exists idx_tweet_seen_member on tweet_seen (member_id);

-- 시드: 기본 워크스페이스·기본 멤버 (하나도 없을 때만)
insert into workspace (name) select '기본' where not exists (select 1 from workspace);
insert into member (name, color) select '박구건', '#1d9bf0' where not exists (select 1 from member);

-- deck_column → workspace 귀속
alter table deck_column add column if not exists workspace_id uuid references workspace(id) on delete cascade;
update deck_column set workspace_id = (select id from workspace order by created_at limit 1) where workspace_id is null;
alter table deck_column alter column workspace_id set not null;

-- candidate → workspace·member 귀속
alter table candidate add column if not exists workspace_id uuid references workspace(id) on delete cascade;
alter table candidate add column if not exists member_id uuid references member(id) on delete cascade;
update candidate set workspace_id = (select id from workspace order by created_at limit 1) where workspace_id is null;
update candidate set member_id = (select id from member order by created_at limit 1) where member_id is null;
alter table candidate alter column workspace_id set not null;
alter table candidate alter column member_id set not null;

-- 후보 유니크: 트윗당 1개 → 트윗×워크스페이스×멤버당 1개
alter table candidate drop constraint if exists candidate_tweet_id_key;
create unique index if not exists idx_candidate_tweet_ws_member on candidate (tweet_id, workspace_id, member_id);

-- 기존 읽음(tweet.seen_at) → 기본 멤버의 tweet_seen으로 이관 (tweet.seen_at 컬럼은 유지, 코드 참조만 제거)
insert into tweet_seen (tweet_id, member_id, seen_at)
select t.tweet_id, (select id from member order by created_at limit 1), t.seen_at
  from tweet t where t.seen_at is not null
on conflict do nothing;
