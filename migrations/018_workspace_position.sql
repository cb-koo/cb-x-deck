-- 워크스페이스 순서: 지금까지 position이 전부 0(미사용)이었다 → 생성순으로 1회 backfill.
-- 재실행 안전: 이미 부여된 상태(max>0)면 건너뛴다. 워크스페이스가 1개뿐이면 재실행해도 결과 동일.
update workspace w
set position = t.rn - 1
from (select id, row_number() over (order by created_at) as rn from workspace) t
where w.id = t.id
  and (select coalesce(max(position), 0) from workspace) = 0;
