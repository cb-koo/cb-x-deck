-- 036: 인플루언서 정산 결제 수단 (스펙 2026-08-27-influencer-payment-method-design)
-- 033~035는 다른 작업(캠페인 관리·랜딩 이벤트·게시물 역할)이 이미 소모했으므로 036부터.
-- apply-migrations.sh가 매번 전 파일을 재적용하므로 재실행 안전(016·023·032 관례).

alter table influencer add column if not exists payment_methods jsonb not null default '[]';

-- 제약 이름은 032와 동일(influencer_log_event_type_check) — drop + add로 'payment_method_changed' 추가.
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed','payment_method_changed'));
