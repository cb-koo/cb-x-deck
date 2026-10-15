-- 076: 검색 트렌드 '새로 뜨는 검색' 후보(10-15) — 우리 시술 목록에 없는데 1년 새 늘어난 검색을 매달 모아 사람이 고른다.
-- 스펙 docs/superpowers/specs/2026-10-13-search-trends-design.md §11. 추가만 한다(새 테이블) — 옛 코드는 모른다. 재실행 안전(멱등).
create table if not exists trend_candidate (
  id               uuid primary key default gen_random_uuid(),
  market           text not null default 'jp',
  kind             text not null check (kind in ('new', 'variant', 'concern', 'self', 'clinic', 'other')),
  term             text not null,               -- 핵심어(일본어) — 새 시술 이름·다른 표기·고민
  norm             text not null,               -- 같은 후보 판정(띄어쓰기 없앤 소문자)
  ko               text,                        -- 한국어 표기
  of_procedure_id  text references trend_procedure(id) on delete set null,  -- 다른 표기면 어느 시술의 표기인지
  texts            text[] not null default '{}', -- 이 후보로 묶인 실제 검색어(예시)
  volume           int not null default 0,      -- 대표 검색어의 최근 3개월 월평균
  increase         int not null default 0,      -- 1년 전 같은 3개월보다 는 월 검색 수
  found_month      text not null,               -- 찾은 기준 달(YYYY-MM)
  status           text not null default 'open' check (status in ('open', 'added', 'ignored')),
  decided_at       timestamptz,
  decided_by_name  text,
  created_at       timestamptz not null default now(),
  unique (market, kind, norm)
);
create index if not exists idx_trend_candidate_open on trend_candidate (market, status);
alter table trend_candidate enable row level security;
