-- 037: 클라이언트 월 마케팅 예산 (스펙 2026-08-27-client-monthly-budget-design §3)
-- 036은 정산 결제 수단 브랜치(cb-koo/influencer-profile)가 쓴다 → 037. apply-migrations.sh가 전 파일을 재적용하므로 재실행 안전.
-- 예산은 저장하고 집행·잔액은 계산한다(캠페인 스펙 §0). 예외 달만 jsonb에 — 기본값을 바꿔도 예외로 적은 달은 안 움직인다.
alter table client add column if not exists monthly_budget int;                          -- 기본 월 예산(원). null = 미설정
alter table client add column if not exists budget_overrides jsonb not null default '{}'; -- {"YYYY-MM": int} 예외 달만
