-- 068: 클라이언트 현황 기간 개정(스펙 2026-10-09-client-status-design.md §2·§6, koo 10-10).
-- ① 주차 판정 확정 때 그때 본 숫자(snapshot)와 주차 끝(period_end — 캠페인 주차는 3~7일)
-- ② 월 방향 기록(확대·유지·축소·전환) — 클라이언트 월간 보고에 맞춘 큰 방향
-- ③ 리포트 스냅샷에 캠페인 주차(cweek: 월 경계에서 잘린 주) 허용 — 제약을 넓히는 쪽이라 옛 코드에 무해
-- 추가만 한다(AGENTS.md). 매 운영 빌드가 다시 돌므로 전부 멱등.
alter table client_weekly_review add column if not exists period_end date;
alter table client_weekly_review add column if not exists snapshot jsonb;

create table if not exists client_monthly_review (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id) on delete cascade,
  month_start date not null,
  direction text not null check (direction in ('expand', 'keep', 'shrink', 'pivot')),
  memo text not null default '',
  snapshot jsonb,
  decided_by uuid,
  decided_by_name text not null default '',
  decided_at timestamptz not null default now(),
  unique (client_id, month_start)
);

alter table report_snapshot drop constraint if exists report_snapshot_granularity_check;
alter table report_snapshot add constraint report_snapshot_granularity_check check (granularity in ('day', 'week', 'month', 'cweek')) not valid;
