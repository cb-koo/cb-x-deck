-- 030: 클릭 스냅샷에 최근 7일 일별 추이 저장 — 표의 스파크라인·펼침 차트가 페이지 로드 시 외부 호출 없이
-- 그려지도록(koo 확정 A안 2026-08-25). 새로고침 한 번 = 합계 + 7일 추이를 같은 시점에 기록해
-- 클릭 열과 추이가 '마지막 새로고침 기준' 하나의 시점으로 일관된다.
-- 값: [{"date":"YYYY-MM-DD","clicks":N}, ...] (오래된 날 → 오늘 순, 7개). null = 추이 미수집(옛 스냅샷·조회 실패).
alter table link_click_snapshot add column if not exists daily jsonb;
