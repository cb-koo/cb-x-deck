-- 작업 삭제 기록 — 누가 언제 어떤 작업을 지웠는지 남긴다(koo 10-13).
-- 예약이 연결된 방문 작업도 확인을 거치면 예약 기록(예약·변경 내역·종료·동의서 업로드)과 함께 지울 수 있게 되면서,
-- 지운 내용을 snapshot(jsonb)에 통째로 보존한다. task_id에는 FK를 걸지 않는다 — 원본 작업은 이미 없다.
-- 캠페인이 지워지면 그 캠페인의 삭제 기록도 함께 사라진다(캠페인 자체가 없으니 보여줄 화면이 없다).
create table if not exists campaign_task_deletion (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null,
  campaign_id       uuid not null references campaign(id) on delete cascade,
  influencer_handle text,
  task_type         text,
  with_reservation  boolean not null default false,
  snapshot          jsonb not null,
  deleted_by        uuid references member(id) on delete set null,
  deleted_by_name   text not null default '',
  deleted_at        timestamptz not null default now()
);
create index if not exists idx_campaign_task_deletion_campaign on campaign_task_deletion (campaign_id, deleted_at desc);
alter table campaign_task_deletion enable row level security;
