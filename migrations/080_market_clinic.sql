-- 080: 클리닉 지도(clinic-sales 병원별 추정 매출을 지도에 — 영업 대상 찾기). 스펙 docs/superpowers/specs/2026-10-17-clinic-map-design.md §3
-- 추가만 한다(AGENTS.md 마이그레이션 규칙) — 새 테이블뿐이라 옛 코드는 모른다. 재실행 안전(멱등).
-- 매출 추정 데이터라 내부 전용이다: 화면·API는 로그인한 팀원만(파일로 공개 경로에 두지 않는다).

-- 병원 한 곳 × 진료과. id는 clinic-sales 기관 id(자연키) — 한 병원이 여러 진료과 목록에 함께 오르므로(피부과+성형외과 등 232곳)
-- 키는 (진료과, id)다. 비교·순위·점수는 진료과 안에서 낸다. 수집 때마다 덮어쓴다 — 파생 지표도 여기 저장해
-- 화면이 계산하지 않게 한다(라벨과 값이 늘 같도록, UX 원칙 4).
create table if not exists market_clinic (
  dept           text not null,                 -- 피부과 · 치과 · 성형외과
  id             text not null,
  name           text not null,
  address        text not null default '',
  sido           text not null default '',
  gu             text not null default '',
  sgg_code       text,                          -- 행정경계(admdongkor) 시군구 코드 — 지도 구역 색칠과 맞춘다
  dong_code      text,
  dong           text,
  lat            double precision,
  lng            double precision,
  area_m2        double precision,
  opened_on      date,
  doctors        int not null default 0,
  specialists    int not null default 0,
  departments    text,
  brand          text not null default '',
  branches       int not null default 1,
  is_chain       boolean not null default false,
  registered     boolean not null default false, -- 외국인환자 유치기관 등록
  countries      text[] not null default '{}',
  latest_month   text,                          -- 매출이 있는 마지막 달(YYYY-MM)
  derived        jsonb not null default '{}',    -- {growth, guRank, guCount, salesPctl, effGap, sigUnderused, sigDomesticStrong, score, isNew}
  seen_at        timestamptz not null default now(), -- 마지막 수집에서 본 때(목록에서 빠진 병원 구분)
  updated_at     timestamptz not null default now(),
  primary key (dept, id)
);

-- 달별 매출. clinic-sales는 최근 몇 달만 주므로 여기 쌓아 두면 추이가 길어진다.
create table if not exists market_clinic_month (
  dept           text not null,
  clinic_id      text not null,
  month          text not null,                 -- YYYY-MM
  sales          bigint,
  sales_domestic bigint,
  sales_foreign  bigint,
  foreign_pct    double precision,
  visits         int,
  visits_foreign int,
  foreign_arpu   bigint,
  sales_per_doctor bigint,
  sales_per_area bigint,
  estimate_type  text,                          -- '정확값…' 이 아니면 추정치(같은 건물 면적 배분 등)
  primary key (dept, clinic_id, month),
  foreign key (dept, clinic_id) references market_clinic(dept, id) on delete cascade
);

-- 병원 ↔ 우리 쪽(cb-x-deck 클라이언트 · monthly-report 고객/리드). 한 고객이 여러 지점을 가질 수 있다(블리비 4, 벤자민 2).
-- monthly-report 쪽 id(report.clinic · report.lead)는 FK를 걸지 않는다 — 그 앱 테이블에 의존하지 않고 읽기만 한다
-- (report.clinic.client_id가 FK 없이 public.client를 가리키는 것과 같은 방식).
create table if not exists market_clinic_link (
  id               uuid primary key default gen_random_uuid(),
  dept             text not null,
  clinic_id        text not null,
  report_clinic_id uuid,                        -- monthly-report report.clinic.id (고객)
  lead_id          uuid,                        -- monthly-report report.lead.id (제안서 보낸 리드)
  branch           text,                        -- 지점 이름(명동·신사 …)
  created_by       uuid references member(id) on delete set null,
  created_at       timestamptz not null default now(),
  check (report_clinic_id is not null or lead_id is not null),
  foreign key (dept, clinic_id) references market_clinic(dept, id) on delete cascade
);
create unique index if not exists uq_market_link_report on market_clinic_link (dept, clinic_id, report_clinic_id) where report_clinic_id is not null;
create unique index if not exists uq_market_link_lead on market_clinic_link (dept, clinic_id, lead_id) where lead_id is not null;

-- 화면이 읽는 완성본 — 수집이 끝날 때마다 다시 만든다(검색 트렌드 trend_view와 같은 방식). 영업 상태는 여기 넣지 않고
-- 요청 때 monthly-report에서 읽어 붙인다(연결은 사람이 바꾸므로).
create table if not exists market_map_view (
  id       text primary key,                    -- 'kr'
  built_at timestamptz not null default now(),
  doc      jsonb not null
);

-- 수집 실행 기록 — 언제 무엇을 받았는지, 멈춤 확인.
create table if not exists market_run (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  months      text[],
  detail      jsonb,
  error       text
);

alter table market_clinic enable row level security;
alter table market_clinic_month enable row level security;
alter table market_clinic_link enable row level security;
alter table market_map_view enable row level security;
alter table market_run enable row level security;
