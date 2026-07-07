-- cb-x-deck v1 스키마. 'column'은 예약어라 deck_column 사용.
create table if not exists deck_column (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('search','watchlist')),
  title text not null,
  position int not null default 0,
  config jsonb not null default '{}'::jsonb,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists tweet (
  tweet_id text primary key,
  author_handle text not null,
  author_name text,
  author_avatar_url text,
  author_followers bigint,
  text text not null default '',
  media jsonb not null default '[]'::jsonb,
  quoted jsonb,
  metrics jsonb not null default '{}'::jsonb,
  tweet_url text,
  tweet_created_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_fetched_at timestamptz not null default now(),
  seen_at timestamptz
);

create table if not exists column_tweet (
  column_id uuid not null references deck_column(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  first_appeared_at timestamptz not null default now(),
  primary key (column_id, tweet_id)
);

create table if not exists candidate (
  id uuid primary key default gen_random_uuid(),
  tweet_id text not null unique references tweet(tweet_id) on delete cascade,
  memo text not null default '',
  source_column_id uuid references deck_column(id) on delete set null,
  saved_at timestamptz not null default now()
);

create table if not exists tag (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table if not exists candidate_tag (
  candidate_id uuid not null references candidate(id) on delete cascade,
  tag_id uuid not null references tag(id) on delete cascade,
  primary key (candidate_id, tag_id)
);

create index if not exists idx_tweet_seen on tweet (seen_at) where seen_at is null;
create index if not exists idx_column_tweet_col on column_tweet (column_id);
