-- 082: 조회수 추정값 — 측정이 게시 후 14일 전에 멈춘 게시물의 빈 날(1~14일차)을 채운 값(koo 10-22).
-- 실측(post_metric_snapshot)과 섞지 않으려고 따로 둔다 — 최신 지표·성과·리포트는 전부 실측만 읽으므로 추정값이 끼어들 길이 없다.
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 새 테이블뿐이라 옛 코드는 모른다. 재실행 안전(멱등).

create table if not exists post_metric_estimate (
  id              uuid primary key default gen_random_uuid(),
  tracked_post_id uuid not null references tracked_post(id) on delete cascade,
  day             int not null check (day between 1 and 14),  -- 게시 후 N일차
  estimated_at    timestamptz not null,                       -- 이 값이 가리키는 시각 = 게시 시각 + N일
  views           bigint not null,
  method          text not null,   -- 추정 방식 이름(버전 포함) — 방식을 바꾸면 이름을 바꿔 옛 값과 구분한다
  basis           jsonb not null,  -- 근거: 앞뒤 실측(나이·조회수)과 참고한 글 수 — 나중에 다시 계산하거나 검산할 때 쓴다
  created_at      timestamptz not null default now(),
  unique (tracked_post_id, day)
);
