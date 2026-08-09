-- 워크스페이스 생성자 기록. 재실행 안전(idempotent).
-- 이전에 만들어진 워크스페이스는 생성자가 기록된 적이 없어 소급 불가 → null 유지, UI는 표시 생략
-- (모르는 값을 아는 척 표시하지 않는다 — AGENTS.md 원칙 4).
alter table workspace add column if not exists created_by uuid references member(id) on delete set null;
