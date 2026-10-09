-- 067: 클라이언트 현황 — 주별 판정 기록(스펙 docs/superpowers/specs/2026-10-09-client-status-design.md §6).
-- 담당자가 확정한 판정 + 메모 + 확정 당시 규칙 제안값(규칙을 다듬을 근거). 같은 클라이언트·같은 주는 한 줄(다시 확정하면 덮어씀).
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 옛 코드는 이 표를 모르니 무해. 매 운영 빌드가 다시 돌므로 멱등.
create table if not exists client_weekly_review (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id) on delete cascade,
  week_start date not null,
  verdict text not null check (verdict in ('keep', 'watch', 'adjust', 'hold')),
  suggested text not null check (suggested in ('keep', 'watch', 'adjust', 'hold')),
  memo text not null default '',
  decided_by uuid,
  decided_by_name text not null default '',
  decided_at timestamptz not null default now(),
  unique (client_id, week_start)
);
