-- 048: 결제 요청 제자리 수정(스펙 docs/superpowers/specs/2026-09-07-settlement-in-place-revision-design.md §3)
-- 그쪽 09-07 제안 수용: 같은 request_id·정산코드로 요청을 고치고 revision을 올린다. 고치기 전 행은 이력 표에 그대로 남긴다 —
-- "돈 값은 요청 시점 확정값" 원칙을 이력 보존으로 지킨다.
alter table payment_request add column if not exists revision int not null default 0;
alter table payment_request add column if not exists revised_at timestamptz;

create table if not exists payment_request_revision (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references payment_request(id) on delete cascade,
  revision int not null,                 -- 보관하는 판 번호 = 고치기 전 payment_request.revision
  snapshot jsonb not null,               -- 고치기 전 행(PaymentRequestRow 모양, 그쪽 결과·담당자 포함)
  reason text not null,
  revised_by uuid,                       -- member.id (삭제돼도 이름은 남긴다)
  revised_by_name text not null,
  created_at timestamptz not null default now(),
  unique (request_id, revision)
);
create index if not exists idx_payment_request_revision_request on payment_request_revision (request_id, revision);

-- 활동 기록에 '정산 요청 수정' 이벤트를 허용한다(041의 목록 + payment_revised). 재실행 안전(drop if exists → add).
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed',
                        'payment_method_changed','payment_requested','payment_cancelled','payment_paid','payment_revised'));
