-- 065: 정산팀 지급 금액 ≠ 작업 금액 처리(스펙 2026-10-07-settlement-diff-reconcile-design.md §7)
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 빌드 중 옛 코드는 새 테이블·칸을 모르니 무해하다.
-- 전 파일이 매 운영 빌드마다 다시 돌므로 모든 문장은 재실행 안전(멱등).

-- 작업 칸 변경 이력 — 지금은 금액만. field로 다른 칸을 나중에 같은 테이블에 쌓는다(koo 10-07 B-3).
-- 지우거나 고치는 API는 없다(스펙 §6). 작업이 지워지면 같이 지워진다 — 정산 요청이 있는 작업은 삭제가 이미 막혀 있다.
create table if not exists task_change (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references campaign_task(id) on delete cascade,
  field       text not null check (field in ('cost')),
  before      jsonb,            -- {amount,currency} | null
  after       jsonb,
  source      text not null check (source in ('campaign', 'replace', 'settlement')),
  reason      text not null default '',
  request_id  uuid references payment_request(id) on delete set null,
  by_member   uuid references member(id) on delete set null,
  by_name     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_task_change_task on task_change (task_id, created_at desc);
-- 요청 목록이 요청마다 '맞춤 이전 금액'을 찾는다(settlementStore R_SELECT) — request_id로 바로 찾도록
create index if not exists idx_task_change_request on task_change (request_id) where request_id is not null;

-- 지급 금액 차이 처리 기록. 기존 diff_ack_at·diff_ack_by_name을 그대로 쓰고 종류·사유·처리 때 값을 더한다.
-- 기존 확인 기록(종류 null)은 옛 기록으로 그대로 둔다 — 화면에 '확인함'으로만 보이고 판정을 숨기지 않는다(스펙 §7).
-- add column if not exists는 칸이 있으면 check까지 통째로 건너뛰므로 재실행해도 제약이 겹치지 않는다.
alter table payment_request
  add column if not exists diff_ack_kind      text check (diff_ack_kind in ('matched', 'kept')),
  add column if not exists diff_ack_reason    text,
  add column if not exists diff_ack_task_cost jsonb;   -- 처리 때의 작업 금액 — 지금과 다르면 다시 표시(§4-4)
