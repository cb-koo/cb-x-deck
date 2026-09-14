-- 033: 캠페인 관리 — campaign · campaign_influencer_cost · draft 3컬럼
-- 설계: docs/superpowers/specs/2026-08-25-campaign-management-design.md §2
-- main은 032까지(032 = 협찬 단가·계정 분석 — influencer.pricing은 그쪽이 만든다) → 033.
-- scripts/apply-migrations.sh가 전 파일을 다시 돌므로 모든 문장이 재실행 안전해야 한다.

-- 캠페인 = 클라이언트 1 × 기간 1 동안 나가는 원고의 묶음(§0).
-- 상태·인플 목록·합계는 저장하지 않고 계산한다(§2-4) — 저장하면 원고 배정과 어긋나는 값이 생긴다(§10).
create table if not exists campaign (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references client(id) on delete set null,
  client_name text,                                   -- 스냅샷(014 관례) — 클라 삭제 후에도 표시 유지
  name        text not null,                          -- 화면 이름. 기본 제안 '{클라} {M월 N주}', 수정 가능
  name_en     text not null,                          -- 영문 코드(checkCampaign 규칙) → 트래킹 링크 utm_campaign 기본값
  starts_on   date not null,                          -- 서울 기준 날짜(DateOnly). 읽을 때 to_char 필수(시간대 시프트 방지)
  ends_on     date not null,
  kind        text check (kind in ('content', 'visit', 'seeding')), -- null 허용. 표시·필터용, 로직 분기 없음
  note        text not null default '',
  created_by  uuid references member(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),     -- 트리거 없음 — 스토어가 updated_at = now() 수동 갱신(clientStore 관례)
  constraint campaign_period_check check (ends_on >= starts_on)
);
create index if not exists idx_campaign_client on campaign (client_id);
create index if not exists idx_campaign_starts on campaign (starts_on desc);

-- 명단이 아니다(§2-2) — 캠페인×핸들에 붙는 추가 비용·메모의 저장소. 행은 처음 적을 때 생긴다.
-- 인플 목록 자체는 원고의 influencer_handle에서 파생한다(§2-4).
create table if not exists campaign_influencer_cost (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaign(id) on delete cascade,
  influencer_handle text not null,                    -- 핸들 자연키(023 관례), 사용자가 친 표기 보존
  extra_costs       jsonb not null default '[]',      -- [{label: string, amount: int ≥ 0, currency: 'KRW'|'JPY'}]
  note              text not null default '',         -- 이 캠페인에서 이 사람에 대한 한 줄
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- 핸들은 대소문자 무관 — 표기는 보존하되 같은 캠페인 안의 중복은 소문자 기준으로 막는다(influencer 관례)
create unique index if not exists idx_cic_campaign_handle_lower
  on campaign_influencer_cost (campaign_id, lower(influencer_handle));

-- 원고가 캠페인의 단위(§0). 원고는 캠페인보다 오래 산다 → 캠페인 삭제 시 set null(예정일·비용은 원고에 남는다).
alter table draft add column if not exists campaign_id uuid references campaign(id) on delete set null;
alter table draft add column if not exists scheduled_on date;   -- 게시 예정일(서울). null = 미정
alter table draft add column if not exists cost jsonb;          -- {type, amount, currency}. null = 없음
create index if not exists idx_draft_campaign on draft (campaign_id);
