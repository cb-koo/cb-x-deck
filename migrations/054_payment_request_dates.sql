-- 054: 정산 요청에 캠페인 기간·게시일 스냅샷 (koo 2026-09-14)
-- 그쪽(정산 프로덕트) API에 campaign.starts_on / campaign.ends_on / posted_on / confirmed_on 으로 나간다.
-- 단가·결제 수단과 같은 '요청 시점 값 고정' 규칙 — 원본 캠페인 기간을 고쳐도 요청 값은 그대로이고,
-- [고친 값으로 다시 반영](제자리 수정)이 새 값을 가져오면서 updated_at을 갱신해 그쪽이 다시 집어간다.
alter table payment_request
  add column if not exists campaign_starts_on date,
  add column if not exists campaign_ends_on   date,
  add column if not exists task_posted_on     date;   -- 작업의 posted_at 스냅샷. RT는 실제 리트윗 시각이 아니라 담당자가 확인한 날
comment on column payment_request.campaign_starts_on is '요청 시점 캠페인 시작일 스냅샷(054). null = 백필 전 옛 요청(캠페인 삭제)';
comment on column payment_request.campaign_ends_on   is '요청 시점 캠페인 종료일 스냅샷(054)';
comment on column payment_request.task_posted_on     is '요청 시점 작업 게시일 스냅샷(054). RT는 확인일. null = 작업이 삭제된 옛 요청';

-- 백필: 기존 요청은 연결된 캠페인·작업의 현재값으로 채운다(요청 시점 값은 복원할 수 없어 현재값이 최선).
-- 캠페인·작업이 지워진 요청은 null로 남는다. 이미 값이 있는 행은 건드리지 않는다(재실행 안전).
update payment_request r
   set campaign_starts_on = c.starts_on, campaign_ends_on = c.ends_on
  from campaign c
 where c.id = r.campaign_id and r.campaign_starts_on is null;
update payment_request r
   set task_posted_on = t.posted_at
  from campaign_task t
 where t.id = r.task_id and r.task_posted_on is null and t.posted_at is not null;
