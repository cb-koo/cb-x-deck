-- 인용 트윗 보강 캐시 — tweet/detail로 1회 조회 후 영구 보관 (ID당 평생 1콜)
create table if not exists quoted_tweet (
  id text primary key,               -- 인용 트윗 ID
  status text not null default 'ok', -- 'ok' | 'missing' (삭제·비공개 tombstone: 재조회 방지)
  data jsonb,                        -- DeckTweet 형태 (status='ok'일 때만)
  fetched_at timestamptz not null default now()
);
