-- 013: deck_column.position 실사용 시작.
-- 그동안 position은 항상 0이었고 실질 정렬은 created_at이었다. 기존 컬럼에
-- '지금 보이던 그 순서'를 번호로 굳혀서 사용자 눈에는 변화가 없게 한다.
--
-- 재실행 안전: apply-migrations.sh가 매번 모든 파일을 다시 실행한다.
-- 이미 번호가 매겨진 워크스페이스(max(position) > 0)는 건드리지 않는다 —
-- 안 그러면 마이그레이션을 돌릴 때마다 사용자가 정한 순서가 생성순으로 되돌아간다.
with untouched as (
  select workspace_id
    from deck_column
   group by workspace_id
  having max(position) = 0
), ranked as (
  select id,
         row_number() over (partition by workspace_id order by created_at) - 1 as rn
    from deck_column
   where workspace_id in (select workspace_id from untouched)
)
update deck_column c
   set position = r.rn
  from ranked r
 where c.id = r.id
   and c.position <> r.rn;
