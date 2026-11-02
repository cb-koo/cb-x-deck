-- 085: 캠페인 마감 — 남은 작업과 상관없이 사람이 캠페인을 '정리 끝'으로 표시한다(ISSUE-004·005, koo 11-02).
-- 작업·비용·정산은 건드리지 않는다. closed_at이 null이 아니면 목록에서 지난 캠페인으로 가고 점이 회색이 된다.
-- [다시 열기]는 두 칸을 null로 되돌린다. 추가만 한다(AGENTS.md 마이그레이션 규칙) — 옛 코드는 이 칸을 모른다. 멱등.
alter table campaign add column if not exists closed_at timestamptz;
alter table campaign add column if not exists closed_by_name text;   -- 마감한 사람 이름 스냅샷(payment_request 관례)
