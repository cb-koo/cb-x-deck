-- 024: 인플루언서 명부 — 협업 인플루언서 단일 목록 + 기록 타임라인 (스펙 2026-08-13)
-- influencer는 client 선례를 따라 최상위 엔티티(워크스페이스 FK 없음). 재실행 안전.
create table if not exists influencer (
  id uuid primary key default gen_random_uuid(),
  handle text not null,                  -- '@' 없는 핸들, 입력 표기 보존(parseXHandle 결과)
  x_user_id text,                        -- 개명 대비 식별자 — 최초 프로필 조회 시 채움
  display_name text,                     -- 이하 4개: X 프로필 스냅샷 (null = 미조회)
  avatar_url text,
  bio text,
  followers_count int,
  profile_refreshed_at timestamptz,      -- null = 미조회. "○일 전 기준" 표시 근거
  tags jsonb not null default '[]',      -- string[] 자유 태그
  note text not null default '',         -- 고정 메모 — 시간과 무관한 정보(단가·주의사항)
  created_by uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
-- X 핸들은 대소문자 무관 — 표기는 보존하되 중복은 소문자 기준으로 막는다
create unique index if not exists idx_influencer_handle_lower on influencer (lower(handle));

-- 수동 한 줄 기록과 자동 앱 이벤트를 같은 시계열에 (스펙 §2)
create table if not exists influencer_log (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references influencer(id) on delete cascade,
  kind text not null check (kind in ('manual','auto')),
  event_type text check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed')),
  body text,                             -- manual 전용: 사용자가 친 한 줄 (표시 문구는 저장하지 않는다 — auto는 UI가 event_type으로 렌더)
  channel text check (channel in ('dm','line','email','other')),
  draft_id uuid references draft(id) on delete set null,
  draft_title text,                      -- 스냅샷 — 원고 삭제 후에도 로그 재현(client_name 선례)
  payload jsonb,                         -- 구조 데이터. handle_changed: {"from","to"}
  author_id uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_influencer_log_timeline on influencer_log (influencer_id, created_at desc);
