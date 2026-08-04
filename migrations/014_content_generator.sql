-- 014: 콘텐츠 생성 — 클라이언트(최상위 엔티티)·시술·초안. 재실행 안전.
-- 클라이언트는 워크스페이스에 속하지 않는다(워크스페이스는 목적별 복수 생성됨).
create table if not exists client (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  info text not null default '',              -- 클리닉·의사 자유 서술
  banned_phrases jsonb not null default '[]', -- string[] — 생성 제약(옵션)·검수 기준(상시) 양쪽에 사용
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists client_procedure (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references client(id) on delete cascade,
  name text not null,
  description text not null default '',
  effect_phrases text not null default '',    -- 효과·결과로 쓸 수 있는 표현(자유 서술)
  banned_phrases jsonb not null default '[]',
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_procedure_client on client_procedure (client_id);

-- 초안: 최상위(워크스페이스 FK 없음). 근거 재현을 위해 생성 시점 스냅샷을 함께 저장(briefing.content 선례).
create table if not exists draft (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references client(id) on delete set null,
  client_name text,                            -- 스냅샷 — 클라 수정·삭제 후에도 풋터 재현
  procedure_names jsonb not null default '[]', -- string[] 스냅샷
  direction text not null default '',          -- 방향성(선택 사항 — 3요소 중 하나)
  format text not null check (format in ('single','thread')),
  reference_mode text not null check (reference_mode in ('off','form','angle','both')),
  refs jsonb not null default '[]',            -- RefSnapshot[] ("references"는 SQL 예약어라 refs)
  content jsonb not null,                      -- DraftContent {posts:[{text, media:[]}]} 생성 원본. 불변
  edited jsonb,                                -- 편집본(동일 모양). null = 미편집
  dismissed_flags jsonb not null default '[]', -- string[] — "kind:term" 키
  model text,
  created_by uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_draft_created on draft (created_at desc);
create index if not exists idx_draft_client on draft (client_id);
