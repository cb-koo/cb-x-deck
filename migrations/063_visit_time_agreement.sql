-- 063: 방문협찬 — 방문일·게시 예정일의 시간 + 협찬 동의서 첨부 (koo 09-29)
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 빌드 중 옛 코드는 이 칸들을 모르니 무해하다.
-- 전 파일이 매 운영 빌드마다 다시 돌므로 모든 문장은 재실행 안전(멱등).

-- 시간은 방문협찬 작업에만(koo 결정 1). 날짜 칸(visit_on·scheduled_on)은 그대로 두고 옆에 시간만 붙인다 —
-- 밀림·정렬·달력 배치·정산 게시일 같은 날짜 판정은 전부 날짜 칸만 본다(시간은 표시·저장용).
-- time(시간대 없음)인 이유: 값은 한국 벽시계 시각(KST) 그대로다. timestamptz로 합치면 날짜 판정이 시간대 변환을 타게 된다.
alter table campaign_task add column if not exists visit_time time;
alter table campaign_task add column if not exists scheduled_time time;

-- 협찬 동의서 1장 — {url, name, size, mime, by, byName, at}. url은 스토리지 경로(task/<작업id>/<파일id>.<확장자>).
-- 044의 proof(RT 증빙)와 같은 모양에 원래 파일명·크기·형식을 더했다(PDF라 미리보기 대신 파일명으로 알아본다).
-- 정산 프로덕트로는 보내지 않는다(koo 결정 5) — payment_request에는 칸을 만들지 않는다.
alter table campaign_task add column if not exists agreement jsonb;

-- 방문협찬이 아닌 작업에는 시간·동의서가 없다. 앱(campaignTaskInput.visitOnlyGateError)이 먼저 막고, 이건 최후 방어다.
-- not valid = 새로 들어오는/바뀌는 행부터만 검사(036·040·048·055 관례). 옛 코드는 이 칸을 아예 안 쓰므로 거부할 값이 없다.
-- 작업 유형(type)은 만든 뒤 바뀌지 않는다(PATCH에 type 키가 없다) — 방문협찬 행이 나중에 이 제약에 걸릴 일은 없다.
alter table campaign_task drop constraint if exists campaign_task_visit_time_only_visit;
alter table campaign_task add constraint campaign_task_visit_time_only_visit
  check (type = 'visit' or (visit_time is null and scheduled_time is null)) not valid;
alter table campaign_task drop constraint if exists campaign_task_agreement_only_visit;
alter table campaign_task add constraint campaign_task_agreement_only_visit
  check (type = 'visit' or agreement is null) not valid;

-- 비공개 버킷(044·059와 같은 방식) — 보기는 그때그때 서명 URL로만.
-- file_size_limit은 src/lib/taskAgreement.ts의 MAX_TASK_AGREEMENT_BYTES와 반드시 같은 값(10MB).
-- task-proof를 재사용하지 않는 이유: 허용 형식이 다르다(동의서는 PDF가 주, 증빙은 이미지만).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-agreement', 'task-agreement', false, 10485760,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

-- on conflict do nothing은 값을 바꾸지 않는다 — 이미 있던 버킷도 코드 상수와 맞춘다.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['application/pdf','image/jpeg','image/png'],
       public = false
 where id = 'task-agreement';

-- create policy에는 if not exists가 없다 — 재실행 안전하게 drop 후 create(024·044·059 관례).
-- delete 정책을 주지 않는 이유: '바꾸기'·'지우기'는 campaign_task.agreement 포인터만 바꾼다. 파일은 남긴다
-- (비공개라 새지 않고, 받은 동의서가 실수로 사라지지 않는 쪽이 안전하다 — 044와 같은 판단).
drop policy if exists "task-agreement read" on storage.objects;
create policy "task-agreement read" on storage.objects
  for select to authenticated using (bucket_id = 'task-agreement');

drop policy if exists "task-agreement write" on storage.objects;
create policy "task-agreement write" on storage.objects
  for insert to authenticated with check (bucket_id = 'task-agreement');
