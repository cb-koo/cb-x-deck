-- Phase 3: 기간 종합 브리핑 — 생성물 저장(재열람·비교, 재생성 비용 절약)
create table if not exists briefing (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace(id) on delete cascade,
  column_id uuid not null references deck_column(id) on delete cascade,
  period_from date not null,
  period_to date not null,
  sample_size int not null,
  content jsonb not null,   -- {tldr, body, citations, stats} — 저장 시점에 렌더링 전부 포함(재현성)
  model text,
  created_by uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists briefing_ws_created on briefing (workspace_id, created_at desc);
