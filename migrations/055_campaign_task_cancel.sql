-- 055: 작업 취소 (캠페인 v2 결정 문서 R16, ADR 0002) — 추가만, 전 문장 멱등.
-- 취소 = 삭제가 아니라 상태. 게시 확인과 상호 배제(check). 되돌리기를 위해 떼어낸 원고를 기억한다.
alter table campaign_task
  add column if not exists cancelled_at          date,                                              -- 취소일(서울 DateOnly). null = 취소 아님
  add column if not exists cancel_reason         text check (cancel_reason is null or cancel_reason in ('declined','no_response','other')),
  add column if not exists cancel_note           text not null default '',                          -- 사유 메모 한 줄(선택)
  add column if not exists cancelled_draft_id    uuid references draft(id) on delete set null,      -- 취소 때 떼어낸 원고. 원고가 지워지면 null
  add column if not exists cancelled_draft_title text;                                              -- 그 원고 제목 스냅샷 — 원고가 지워져도 "원고 있었음: 제목"
comment on column campaign_task.cancelled_at is '취소일(055). 게시 확인(posted_at)과 공존 불가 — check campaign_task_cancel_xor_posted';
comment on column campaign_task.cancelled_draft_id is '취소 때 떼어낸 원고(055). 되돌리기가 재부착을 시도한다';

-- 취소 ↔ 게시 확인 상호 배제. 경합(취소 직전에 게시 확인이 들어옴)의 최후 방어 — 진 쪽은 23514.
alter table campaign_task drop constraint if exists campaign_task_cancel_xor_posted;
alter table campaign_task add constraint campaign_task_cancel_xor_posted
  check (cancelled_at is null or posted_at is null);

create index if not exists idx_campaign_task_cancelled on campaign_task (campaign_id) where cancelled_at is not null;

-- 인플루언서 타임라인: 작업 거절·무응답(ADR 0001·0005). not valid = 전 파일 재실행 때 뒤 마이그레이션이 넓힌 값과 충돌하지 않게(040 관례).
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed',
                        'payment_method_changed','payment_requested','payment_cancelled','payment_paid','payment_revised',
                        'task_declined')) not valid;
