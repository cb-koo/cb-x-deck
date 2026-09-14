-- 029: 클라이언트 영문 이름 — 트래킹 링크 캠페인명 제안에 사용 (koo QA 2026-08-24:
-- 캠페인은 영문 규칙인데 클라 이름이 한글이면 제안에 클라 구분이 사라진다 → 영문 이름을 따로 등록).
-- 한글 name은 화면·원고 연결 표시용으로 유지 — 용도가 다른 두 표기다.
alter table client add column if not exists name_en text not null default '';
