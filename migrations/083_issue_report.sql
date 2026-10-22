-- 083: 불편 알리기(이슈 리포트) — 팀원이 화면 오른쪽 아래 버튼으로 보낸 불편과 그 처리.
-- 스펙 docs/superpowers/specs/2026-10-22-issue-report-design.md §3
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 새 표와 새 버킷뿐이라 옛 코드는 모른다. 재실행 안전(멱등).

create table if not exists issue_report (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid references member(id) on delete set null,
  reporter_name     text not null,                 -- 보낸 사람 이름 스냅샷(payment_request 관례) — 멤버가 지워져도 남는다
  body              text not null check (length(btrim(body)) > 0),
  screenshot_path   text,                          -- issue-screenshot 버킷 안 경로(issue/<yyyy-mm>/<uuid>.<ext>), 없으면 null
  location          jsonb not null,                -- {screen, title, panel, path, taskId, viewport} — 보낼 때 브라우저가 모은 것
  status            text not null default 'open' check (status in ('open', 'checking', 'resolved')),
  status_changed_at timestamptz,
  reply             text,                          -- 해결 답 한 줄 — 보낸 사람에게 보인다
  replied_by_name   text,
  replied_at        timestamptz,
  reply_seen_at     timestamptz,                   -- 보낸 사람이 답을 본 때. replied_at > reply_seen_at(또는 null)이면 '안 본 답'
  created_at        timestamptz not null default now()
);
create index if not exists issue_report_created_idx on issue_report (created_at desc);
create index if not exists issue_report_reporter_idx on issue_report (reporter_id);

-- 비공개 버킷. 표시는 서명 URL로만. file_size_limit은 src/lib/issueReport.ts의 MAX_ISSUE_SCREENSHOT_BYTES와 같은 값(10MB).
-- task-proof(044)를 재사용하지 않는다 — 정산 증빙 버킷에 이슈 스크린샷이 섞이면 안 되고 경로 규칙도 다르다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-screenshot', 'issue-screenshot', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp'],
       public = false
 where id = 'issue-screenshot';

-- 지우기 정책은 두지 않는다 — 이슈는 지우지 않는다(스펙 §2-4).
drop policy if exists "issue-screenshot read" on storage.objects;
create policy "issue-screenshot read" on storage.objects
  for select to authenticated using (bucket_id = 'issue-screenshot');

drop policy if exists "issue-screenshot write" on storage.objects;
create policy "issue-screenshot write" on storage.objects
  for insert to authenticated with check (bucket_id = 'issue-screenshot');
