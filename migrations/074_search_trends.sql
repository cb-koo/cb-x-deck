-- 074: 검색 트렌드(일본 구글 검색량으로 피부과 시술 수요·추세 보기). 스펙 docs/superpowers/specs/2026-10-13-search-trends-design.md §7
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 새 테이블뿐이라 옛 코드는 모른다. 재실행 안전(멱등).

-- 시술 한 줄. 시트 '클리닉 시술 대지도'에서 한 번 가져온 뒤엔 앱이 원본이다(시트와 다시 맞추지 않는다).
-- id는 시트 행 번호(p12)를 그대로 쓰고, 앱에서 더한 시술은 새로 만든 id. 같은 분류·같은 시술명은 화면에서 한 줄로 묶인다.
create table if not exists trend_procedure (
  id          text primary key,
  market      text not null default 'jp',
  major       text not null,                 -- 시트 대분류(화면 분류는 procedureTaxonomy가 다시 붙인다)
  major_order int  not null default 0,
  middle      text not null default '',
  name        text not null,                 -- 화면 시술명(한국어 짧은 이름)
  kr          text not null default '',
  jp          text not null,                 -- 대표 검색어(일본어)
  en          text not null default '',
  hidden      boolean not null default false,
  sheet       jsonb,                         -- 앱에서 고친 칸의 시트 원래 값(근거 추적용)
  serp        jsonb,                         -- 시술명 검색 결과 구성 {derm,med,self,unrelated,note,checked_at} — 동음이의·타 진료과 판정
  ideas_at    timestamptz,                   -- 연관 검색어를 마지막으로 넓힌 때(분기마다·시술 추가 때)
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_trend_procedure_market on trend_procedure (market) where not hidden;

-- 검색어 하나 = 한 행. 월별 검색량은 배열로 한 칸에 둔다(약 2만 검색어 × 48개월을 행으로 펼치면 읽기가 무겁다).
-- 주인 시술(procedure_id)은 가장 긴(구체적인) 시술 이름이 들어 있는 시술 — 시술이 바뀌면 다시 계산한다.
create table if not exists trend_keyword (
  id              bigint generated always as identity primary key,
  market          text not null default 'jp',
  text            text not null,
  norm            text not null,               -- 띄어쓰기 없앤 소문자(같은 검색어 판정)
  procedure_id    text references trend_procedure(id) on delete set null,
  source          text not null check (source in ('name', 'template', 'idea', 'korea')),
  ko              text,                        -- 한국어 번역(화면에 보이는 검색어만)
  intent_override text,                        -- 검색어 점검에서 사람이 고친 태그(없으면 규칙대로)
  series          int[],                       -- series_start부터 월별 검색량. null = 키워드 플래너가 값을 주지 않음
  series_start    date,
  fetched_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (market, norm)
);
create index if not exists idx_trend_keyword_procedure on trend_keyword (procedure_id);

-- 화면이 읽는 완성본 — 수집·수정이 끝날 때마다 다시 만든다(태그·묶음·판정 재료를 미리 계산해 둔다).
create table if not exists trend_view (
  market   text primary key,
  built_at timestamptz not null default now(),
  doc      jsonb not null
);

-- 수집 실행 기록 — 새 달 확인·연관 검색어 넓히기·번역이 언제 무엇을 했는지. 화면의 '수집' 표시와 멈춤 확인.
create table if not exists trend_run (
  id           uuid primary key default gen_random_uuid(),
  market       text not null default 'jp',
  kind         text not null,                -- check(새 달 확인) · refresh(전체 검색량) · ideas(연관 검색어) · translate · import
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  latest_month text,                         -- 키워드 플래너가 준 마지막 달(YYYY-MM)
  detail       jsonb
);
create index if not exists idx_trend_run_started on trend_run (market, started_at desc);

alter table trend_procedure enable row level security;
alter table trend_keyword   enable row level security;
alter table trend_view      enable row level security;
alter table trend_run       enable row level security;
