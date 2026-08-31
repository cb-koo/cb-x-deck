-- 043: RT 작업 증빙 스크린샷 (스펙 2026-08-31-rt-proof-screenshot-design.md §4·§10)
-- 041·042는 정산 프로덕트 연동 API 브랜치(미머지)가 쓴다 → 이 파일은 043.
-- apply-migrations.sh가 전 파일을 매번 재실행하므로 모든 문장은 재실행 안전(멱등).

-- §4-2 작업 한 건의 증빙 1장 — {url, by, byName, at}. RT 작업에만 채워진다(앱이 지킨다).
alter table campaign_task add column if not exists proof jsonb;

-- §7 정산 요청 스냅샷 — 요청 만든 시점의 증빙을 그대로 복사한다(전송은 아직 안 한다).
alter table payment_request add column if not exists proof jsonb;

-- §4-3 비공개 버킷. 표시·내려받기 모두 서명 URL로만 접근한다.
-- draft-media(024)를 재사용하지 않는 이유: 경로 정규식이 draft/<uuid>/…에 묶여 있고 용량 상한이 다르다.
-- file_size_limit은 src/lib/taskProof.ts의 MAX_TASK_PROOF_BYTES와 반드시 같은 값(10MB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-proof', 'task-proof', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- 이미 만들어져 있던 버킷도 이 값으로 맞춘다 — on conflict do nothing이 값 변경을 안 해서, 상한을
-- 올린 뒤 재실행할 때 코드 상수와 어긋난 채 남는 것을 막는다.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp'],
       public = false
 where id = 'task-proof';

-- create policy에는 if not exists가 없다 — 재실행 안전하게 drop 후 create(024와 같은 관례).
-- delete 정책을 주지 않는 이유: '지우기'·'바꾸기'는 campaign_task.proof 포인터만 바꾼다.
-- 스토리지 객체는 남긴다(비공개라 새지 않고, 교체 흔적이 남는 쪽이 증빙에 유리하다).
drop policy if exists "task-proof read" on storage.objects;
create policy "task-proof read" on storage.objects
  for select to authenticated using (bucket_id = 'task-proof');

drop policy if exists "task-proof write" on storage.objects;
create policy "task-proof write" on storage.objects
  for insert to authenticated with check (bucket_id = 'task-proof');
