-- 071: 정산 요청 자동 전송(2026-10-12 koo 결정 — 검토 단계 없이 매주 월요일 07:00에 정산팀으로).
-- 스펙: docs/superpowers/specs/2026-10-12-settlement-auto-send-design.md §3
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 옛 코드는 새 칸을 모르니 무해하다. 재실행 안전(멱등).

-- 게시 확인한 순간 — posted_at은 날짜뿐이라 "월요일 7시 전에 확인됐나"를 못 가른다.
-- 트리거가 채운다: posted_at이 비었다가 채워지는 경로가 여럿이고(게시 확인·날짜 편집·게시물 연결·일괄 적재·스크립트),
-- 배포 중엔 옛 코드도 쓴다. 기존 행은 아래에서 마지막 수정 시각으로 채운다.
alter table campaign_task add column if not exists posted_confirmed_at timestamptz;
create or replace function campaign_task_stamp_posted_confirmed() returns trigger language plpgsql as $$
begin
  -- 게시 확인을 비우면 시각도 비운다 — 다시 확인할 때 새 시각이 찍혀야 "다음 월요일" 규칙이 맞다
  if new.posted_at is null then
    new.posted_confirmed_at := null;
  elsif new.posted_confirmed_at is null
     and (tg_op = 'INSERT' or old.posted_at is null) then
    new.posted_confirmed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists campaign_task_stamp_posted_confirmed on campaign_task;
create trigger campaign_task_stamp_posted_confirmed before insert or update on campaign_task
  for each row execute function campaign_task_stamp_posted_confirmed();
-- 기존 게시 행의 확인 시각 채우기 — 칸이 생기기 전 행은 확인 시각을 모른다. 게시일 00:00으로 대신하면 월요일에 확인된 작업이
-- "월요일 7시 전 확인"으로 판정돼 켜자마자 나간다(운영 10-13: 10/12 게시 4건). 마지막 수정 시각은 확인 시각과 같거나 늦으므로
-- 일찍 나가는 쪽으로는 틀리지 않는다. 비어 있는 행만 채우고 updated_at은 건드리지 않는다 — 다시 돌려도 결과가 같다(멱등).
update campaign_task set posted_confirmed_at = updated_at
 where posted_at is not null and posted_confirmed_at is null;

-- [보내지 않기] — 자동으로 보내지 않고 '멈춘 작업'에 둔다. [보내기]가 지운다.
alter table campaign_task
  add column if not exists settle_hold_at      timestamptz,
  add column if not exists settle_hold_by      uuid references member(id) on delete set null,
  add column if not exists settle_hold_by_name text,
  add column if not exists settle_hold_reason  text;

-- 요청을 누가 만들었나 — 우리 화면 표시용. 정산팀이 가져가는 데이터에는 넣지 않는다(10-07 엄격 스키마).
alter table payment_request add column if not exists created_via text not null default 'manual';
alter table payment_request drop constraint if exists payment_request_created_via_check;
alter table payment_request add constraint payment_request_created_via_check check (created_via in ('manual', 'auto')) not valid;

-- 보낼 때 이미 내려가 있었나(사람이 [확인하고 보내기]로 보낸 건) — 그 뒤에 새로 생긴 내림·안 보임만 알린다.
-- 내림 날짜는 사람이 나중에 과거 날짜로 적을 수 있어서 날짜 비교로는 못 가른다(리뷰 10-12).
alter table payment_request
  add column if not exists sent_removed_on date,
  add column if not exists sent_unseen_on  date;

-- 보낸 뒤 글이 내려감 → [그대로 두기] 기록. updated_at은 건드리지 않는다(정산팀 폴링에 흐르지 않게).
alter table payment_request
  add column if not exists removal_ack_at      timestamptz,
  add column if not exists removal_ack_by_name text;

-- 자동 전송 실행 기록 — 화면의 "마지막 확인 HH:MM"과 멈춤 경고. 7일 지난 행은 실행이 지운다.
create table if not exists settlement_auto_run (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  sent        int not null default 0,
  failed      int not null default 0,
  detail      jsonb
);
create index if not exists idx_settlement_auto_run_started on settlement_auto_run (started_at desc);
