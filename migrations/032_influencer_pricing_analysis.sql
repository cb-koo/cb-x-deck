-- 032(원래 028 — main의 트래킹 링크 028~031과 번호 충돌로 머지 시 rename, SQL은 동일·프로덕션 적용 완료): 인플루언서 협찬 단가 + 계정 분석 (스펙 2026-08-24-influencer-pricing-analysis)
-- 026(influencer_metrics)은 폐기된 게시물 추적 브랜치에서 소모됐고 프로덕션 DB에 적용된 채 남아 있다 — 그래서 원래 028(머지 시 032로 rename).
-- apply-migrations.sh가 매번 전 파일을 재적용하므로 재실행 안전(016·023 관례).

alter table influencer add column if not exists pricing jsonb not null default '{}';
alter table influencer add column if not exists analysis jsonb;
alter table influencer add column if not exists analyzed_at timestamptz;

-- 제약 이름은 프로덕션에서 확인됨(2026-08-24): influencer_log_event_type_check
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed'));
