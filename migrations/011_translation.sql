-- 트윗 본문 JA→KR 번역 캐시. 원문+프롬프트/용어집이 그대로면 트윗당 1회만 번역(비용 절약).
create table if not exists tweet_translation (
  tweet_id       text primary key references tweet(tweet_id) on delete cascade,
  target_lang    text not null default 'ko',
  source_hash    text not null,   -- 번역한 원문(본문+인용본문)의 해시 — 수정 트윗 감지
  prompt_version int  not null,   -- 프롬프트/용어집 버전 — 개정 시 캐시 무효
  content        text not null,   -- 본문 한국어 번역
  quoted_content text,            -- 인용 트윗 본문 번역(있으면)
  model          text,
  created_at     timestamptz not null default now()
);
