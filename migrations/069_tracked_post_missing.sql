-- 069: 게시물 '안 보임' 확인 기록(2026-10-12 koo 결정 — 사라진 협찬 글을 캠페인 화면에서 알리기).
-- X가 "없음"이라고 한 번 답해도 바로 unavailable_at(확정)을 찍지 않는다 — 1시간 뒤 다시 봐서 또 없을 때만 확정한다(일시 오류 거르기).
-- 확정 뒤에도 게시 후 7일까지는 하루 한 번 다시 확인해, 다시 보이면 풀린다(appendSnapshot이 세 칸을 모두 비운다).
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 옛 코드는 새 칸을 모르니 무해하다. 재실행 안전(멱등).
-- 067·068은 chart-kit 브랜치(클라이언트 현황)가 쓰고 있어 건너뛴다.
alter table tracked_post
  add column if not exists missing_since      timestamptz,   -- X가 처음 "없음"이라고 한 시각(확정 전 포함). 확정되면 unavailable_at이 이 값을 받는다
  add column if not exists missing_checked_at timestamptz;   -- 마지막으로 "없음"을 확인한 시각 — 다시 확인할 때를 정한다
