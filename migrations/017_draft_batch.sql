-- 017: 다중 시안 묶음 (스펙 2026-08-08-variants-refsearch-design.md §1)
-- 한 번의 생성(1콜 N변형)에서 나온 형제 시안들이 같은 batch_id를 공유한다.
-- 단일 생성은 둘 다 null — 기존 행과 동일. variant_index는 0부터(표시 라벨 A/B/C…).
alter table draft add column if not exists batch_id uuid;
alter table draft add column if not exists variant_index int;
