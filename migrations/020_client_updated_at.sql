-- 클라이언트 "마지막 수정" 표기용. 시술 추가/수정/삭제도 앱에서 부모를 touch한다.
-- 재실행 안전: 백필은 null인 행만 채우므로 두 번째 실행이 실제 수정 시각을 덮지 않는다.
alter table client add column if not exists updated_at timestamptz;
update client set updated_at = created_at where updated_at is null;
alter table client alter column updated_at set default now();
alter table client alter column updated_at set not null;
