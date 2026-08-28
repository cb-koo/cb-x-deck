-- 041: 정산 프로덕트 연동(스펙 2026-08-28-payment-api-design §4) — 요청 스냅샷은 그대로, 외부 상태는 옆 칸.
-- apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 멱등.

-- §4-1 외부 상태 컬럼
alter table payment_request add column if not exists external_status text;          -- null = 그쪽이 아직 안 봄
alter table payment_request drop constraint if exists payment_request_external_status_check;
alter table payment_request add constraint payment_request_external_status_check
  check (external_status is null or external_status in ('received','scheduled','paid','on_hold','cancelled'));
alter table payment_request add column if not exists paid_amount_krw int;            -- 실제 지급 원화 확정치
alter table payment_request add column if not exists paid_at timestamptz;
alter table payment_request add column if not exists external_note text;             -- 보류 사유·차액 설명·취소 이유 한 줄
alter table payment_request drop constraint if exists payment_request_external_note_len;
alter table payment_request add constraint payment_request_external_note_len
  check (external_note is null or char_length(external_note) <= 500);
alter table payment_request add column if not exists external_updated_at timestamptz; -- 그쪽이 찍은 변경 시각(순서 보장)
alter table payment_request drop constraint if exists payment_request_paid_fields;
alter table payment_request add constraint payment_request_paid_fields
  check (external_status is distinct from 'paid' or (paid_amount_krw is not null and paid_at is not null));

-- §4-1 인플 UUID 스냅샷(개명 뒤에도 조인) · 분류 옵션 코드
alter table payment_request add column if not exists influencer_id uuid references influencer(id) on delete set null;
alter table payment_request add column if not exists category_option_id text;
create index if not exists idx_payment_request_influencer on payment_request (influencer_id);
update payment_request r set influencer_id = i.id
  from influencer i where r.influencer_id is null and lower(i.handle) = lower(r.influencer_handle);

-- §5-2 폴링 커서
create index if not exists idx_payment_request_updated on payment_request (updated_at, id);

-- §4-2 지급 완료는 종점 — 다른 쓰기 경로가 생겨도 우리 status 변경(취소)을 막는 마지막 벽
create or replace function payment_request_guard_paid() returns trigger language plpgsql as $$
begin
  if old.external_status = 'paid' and new.status is distinct from old.status then
    raise exception 'paid-locked';
  end if;
  return new;
end $$;
drop trigger if exists payment_request_guard_paid on payment_request;
create trigger payment_request_guard_paid before update on payment_request
  for each row execute function payment_request_guard_paid();

-- §4-4 요청자 Slack ID(값은 SQL로 채움, 화면 없음)
alter table member add column if not exists slack_id text;

-- §4-5 인플 활동 기록 이벤트 추가 — 제약 이름은 036·040과 동일(drop + add), not valid 관례(040 주석 참조)
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed',
                        'payment_method_changed','payment_requested','payment_cancelled','payment_paid')) not valid;
