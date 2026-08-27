-- 038: 캠페인 작업(campaign_task) — 캠페인의 단위가 원고 → 작업으로 (스펙 docs/superpowers/specs/2026-08-28-campaign-task-design.md §2)
-- 037은 클라이언트 월 예산이 쓴다(main) → 이 파일은 038. 프로덕션에는 037 번호였을 때 이미 적용했다(추가만 하는 파일이라 재실행 안전).
-- 추가만 한다. draft.campaign_id/scheduled_on/cost 삭제는 039(배포 후) — 이 파일은 main의 옛 코드와 공존해야 한다.
-- scripts/apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 재실행 안전.

create table if not exists campaign_task (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaign(id) on delete cascade,   -- 소속 = 비용을 지는 캠페인
  influencer_handle text,                                                       -- null = 미배정(원고만 먼저 준비). 표기 보존, 비교는 lower()
  type              text not null check (type in ('post', 'quoteRt', 'rt', 'visit')),  -- = influencerPricing.PriceType
  draft_id          uuid references draft(id) on delete set null,             -- 붙은 원고(작업 1개 = 원고 최대 1개, 아래 unique)
  target_task_id    uuid references campaign_task(id) on delete set null,     -- RT/인용RT 대상이 우리 작업일 때(캠페인 제한 없음)
  target_tweet_url  text,                                                      -- 대상이 우리 작업 밖 게시물일 때(tweetPermalink 정규형)
  post_url          text,                                                      -- 인플이 올린 게시물(투고·인용RT·방문협찬의 증거)
  posted_at         date,                                                      -- 게시 확인일(서울). 한 번 찍히면 자동으로 되돌리지 않는다
  posted_source     text check (posted_source in ('auto', 'manual')),
  removed_at        date,                                                      -- 게시 내림일 — 정산 조건이 아니라 판단 참고 정보(§2-1)
  removed_reason    text not null default '',
  scheduled_on      date,                                                      -- 게시 예정일 — 밀림 판정 기준
  visit_on          date,                                                      -- 방문일(type='visit'만) — 밀림 판정에 쓰지 않는다
  cost              jsonb,                                                     -- {amount int ≥0, currency 'KRW'|'JPY'} — type 없음(작업 유형이 대신)
  note              text not null default '',
  created_by        uuid references member(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),                       -- 트리거 없음 — 스토어가 now() 수동 갱신
  constraint campaign_task_not_self check (target_task_id is null or target_task_id <> id)
);
create index if not exists idx_campaign_task_campaign_created on campaign_task (campaign_id, created_at);
create index if not exists idx_campaign_task_handle_lower on campaign_task (lower(influencer_handle));
create index if not exists idx_campaign_task_target on campaign_task (target_task_id);
-- 원고 1개는 작업 1개에만 — 원고의 캠페인 소속이 이 한 행에서 파생된다(값은 하나)
create unique index if not exists idx_campaign_task_draft_unique on campaign_task (draft_id) where draft_id is not null;

-- 게시물은 작업에 붙는다(§2-4). draft_id는 남긴다 — 트래킹·성과 화면이 원고 기준으로 읽는다.
alter table tracked_post add column if not exists task_id uuid references campaign_task(id) on delete set null;
create index if not exists idx_tracked_post_task on tracked_post (task_id);
