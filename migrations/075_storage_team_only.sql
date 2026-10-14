-- 075: 비공개 버킷 넷(draft-media · task-proof · payment-qr · task-agreement)의 Storage 정책을 회사 계정으로 좁힌다.
--
-- 왜: 024 · 044 · 059 · 063의 정책은 `to authenticated` + bucket_id 검사뿐이라 "로그인한 사람이면 누구나"다.
-- 앱 화면은 isAllowedUser(src/lib/auth.ts — 회사 도메인 + 구글 provider)로 막지만, Storage API는 앱을 거치지 않고
-- 공개 anon 키 + 자기 JWT로 바로 부를 수 있어 그 문지기를 지나지 않는다. 지금은 로그인할 수 있는 사람이 회사
-- 계정뿐이라 열린 적이 없다. 하지만 이 Supabase Auth는 monthly-report와 같이 쓰므로, 회사 밖 계정이 하나라도
-- 생기면(어느 앱이든) 그 계정이 증빙 · 결제 QR · 동의서 · 원고 이미지를 직접 읽고 올릴 수 있다.
-- monthly-report의 report-images 정책은 이미 같은 판정을 JWT로 한다(monthly-report src/lib/infra/storage.ts).
--
-- 판정은 isAllowedUser와 같다: 이메일 도메인이 clinicbridge.co.kr이고, 구글 provider로 로그인했다
-- (app_metadata.provider = 'google' 또는 app_metadata.providers에 'google'). 크롬 확장의 Bearer 토큰도 같은
-- Supabase JWT라(extensionClaims.ts가 isAllowedUser로 검사한다) 이 판정을 통과한다. service role로 부르는 경로
-- (external settlement proof · paymentQr의 관리자 클라이언트)는 RLS를 우회하므로 영향이 없다.
--
-- 옛 파일을 고치지 않는다(AGENTS.md: 이미 올린 마이그레이션은 번호도 내용도 고치지 않는다). 빌드는 전 파일을
-- 번호 순서대로 한 트랜잭션에서 다시 돌리므로, 024 · 044 · 059 · 063이 넓은 정책을 만들고 이 파일이 같은 이름으로
-- 바로 덮는다 — 트랜잭션 안이라 넓은 정책이 커밋된 상태로 보이는 순간은 없다.
-- 옛 코드와 공존 안전: 정책만 바뀌고 칸 · 버킷 · 경로는 그대로다. 회사 계정의 동작은 달라지지 않는다.
-- 되돌리기: 이 파일을 지우면 다음 빌드에서 옛 정책으로 돌아간다.

create or replace function public.is_team_jwt() returns boolean
language sql stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) like '%@clinicbridge.co.kr'
     and (
       (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
       or coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
     )
$$;

comment on function public.is_team_jwt() is
  '회사 계정 판정(src/lib/auth.ts isAllowedUser와 같은 규칙) — Storage 정책이 쓴다. 075.';

-- 정책을 평가하는 authenticated가 이 함수를 실행할 수 있어야 한다. 기본값(PUBLIC에 EXECUTE)에 기대지 않고 적는다 —
-- 빠지면 정책 평가가 오류가 나 팀원까지 전부 막힌다(fail closed). 재실행 안전.
grant execute on function public.is_team_jwt() to authenticated;

drop policy if exists "draft-media read" on storage.objects;
create policy "draft-media read" on storage.objects
  for select to authenticated using (bucket_id = 'draft-media' and public.is_team_jwt());

drop policy if exists "draft-media write" on storage.objects;
create policy "draft-media write" on storage.objects
  for insert to authenticated with check (bucket_id = 'draft-media' and public.is_team_jwt());

drop policy if exists "task-proof read" on storage.objects;
create policy "task-proof read" on storage.objects
  for select to authenticated using (bucket_id = 'task-proof' and public.is_team_jwt());

drop policy if exists "task-proof write" on storage.objects;
create policy "task-proof write" on storage.objects
  for insert to authenticated with check (bucket_id = 'task-proof' and public.is_team_jwt());

drop policy if exists "payment-qr read" on storage.objects;
create policy "payment-qr read" on storage.objects
  for select to authenticated using (bucket_id = 'payment-qr' and public.is_team_jwt());

drop policy if exists "payment-qr write" on storage.objects;
create policy "payment-qr write" on storage.objects
  for insert to authenticated with check (bucket_id = 'payment-qr' and public.is_team_jwt());

drop policy if exists "task-agreement read" on storage.objects;
create policy "task-agreement read" on storage.objects
  for select to authenticated using (bucket_id = 'task-agreement' and public.is_team_jwt());

drop policy if exists "task-agreement write" on storage.objects;
create policy "task-agreement write" on storage.objects
  for insert to authenticated with check (bucket_id = 'task-agreement' and public.is_team_jwt());
