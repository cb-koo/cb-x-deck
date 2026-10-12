-- 066: 정산팀이 지급 완료 회신에 보내는 적용 환율(2026-10-07 정산 미러 제안 수용). 기록·표시용 — 판정에는 쓰지 않는다.
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 옛 코드는 새 칸을 모르니 무해하다. 매 운영 빌드가 다시 돌므로 재실행 안전(멱등).
-- 064는 방문 예약용으로 예약돼 있어 건너뛴다.
alter table payment_request
  add column if not exists paid_rate_krw_per_unit numeric,   -- 실지급 외화 1단위당 원화(엔이면 원/엔, 달러면 원/달러)
  add column if not exists paid_rate_date         date,      -- 환율 공시 기준일
  add column if not exists paid_rate_source       text;      -- 환율 출처(정산팀 값 그대로)
