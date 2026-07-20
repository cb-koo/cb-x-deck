-- v1.7 멤버를 로그인 사용자로 자동 결정. 재실행 안전(idempotent).
alter table member add column if not exists email text;
-- 동명이인 대비: name 유니크 제거, email 유니크 신설
alter table member drop constraint if exists member_name_key;
create unique index if not exists idx_member_email on member(email) where email is not null;
-- 기존 박구건 → 로그인 연결(후보 등 데이터 보존)
update member set email = 'gugeon.park@clinicbridge.co.kr' where name = '박구건' and email is null;
-- 빈 테스트 멤버 삭제(후보 0개; scout/dismissed/briefing FK는 on delete set null)
delete from member where name = '멤버 2';
