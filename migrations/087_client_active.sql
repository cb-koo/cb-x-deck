-- 087 클라이언트 비활성화(ISSUE-013, koo 11-06) — 계약이 끝나거나 멈춘 클라이언트를 새 작업 목록(캠페인 만들기·원고 생성·
-- 트래킹 링크·확장 프로그램)에서 뺀다. 지난 캠페인·정산·성과 기록은 그대로 보인다. 다시 시작하면 [다시 활성화]로 비운다.
-- 추가만 한다(옛 코드는 이 칸을 모르니 무해, AGENTS.md 마이그레이션 규칙).
alter table client add column if not exists deactivated_at timestamptz;
alter table client add column if not exists deactivated_by uuid references member(id) on delete set null;
alter table client add column if not exists deactivated_by_name text;
