-- AI 지시문(프롬프트 고정 문장) 오버라이드 — append-only, 최신 행 = 현재값. 행 없음 = 전부 기본값.
-- overrides에는 기본값과 다른 필드만 저장한다(diff) — 코드 기본값이 개선되면 편집 안 한 필드는 자동 추종.
create table if not exists prompt_template_version (
  id uuid primary key default gen_random_uuid(),
  overrides jsonb not null default '{}'::jsonb,
  member_id uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
-- 앱은 직접 Postgres 연결이라 무영향 — anon/authenticated 키만 차단 (신규 테이블 관례)
alter table prompt_template_version enable row level security;
