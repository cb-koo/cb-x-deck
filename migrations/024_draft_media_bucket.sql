-- 024: 초안 이미지 첨부용 비공개 버킷.
-- 비공개(public=false) — 표시·다운로드 모두 서명 URL로만 접근한다. 이미지는 인증된 사람만 본다(설계 §원칙).
-- delete 정책을 주지 않는 이유: 버전 이력(history)이 과거 버전의 media를 그대로 참조하므로
-- 초안에서 이미지를 떼어내도 스토리지 객체는 지우지 않는다(설계 §확정 판단) — 쓰지 않을 권한이다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('draft-media', 'draft-media', false, 5242880,
        array['image/jpeg','image/png','image/gif','image/webp'])
on conflict (id) do nothing;

-- create policy에는 if not exists가 없다. apply-migrations.sh는 적용 이력 테이블 없이
-- migrations/*.sql을 매번 전부 재실행하므로, 정책은 먼저 drop한 뒤 만들어야 재실행 안전(idempotent)하다.
drop policy if exists "draft-media read" on storage.objects;
create policy "draft-media read" on storage.objects
  for select to authenticated using (bucket_id = 'draft-media');

drop policy if exists "draft-media write" on storage.objects;
create policy "draft-media write" on storage.objects
  for insert to authenticated with check (bucket_id = 'draft-media');
