-- 028: 트래킹 링크 — 랜딩페이지+UTM+단축 링크 명부 + 클릭 스냅샷(append-only).
-- 설계: docs/superpowers/specs/2026-08-24-tracking-link-design.md
create table if not exists tracking_link (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,  -- 6자 소문자 영숫자. 세 곳을 잇는 축:
                                          -- 단축 경로({도메인}/{code}) = utm_content 꼬리 = 이 행.
                                          -- GA에서 본 utm_content로 앱의 링크·원고 역추적 가능
  landing_url      text not null,         -- UTM 붙기 전 원본
  long_url         text not null,         -- UTM 붙은 최종 URL 스냅샷 — 조립 규칙이 바뀌어도 과거 링크 재현
  short_url        text not null,         -- https://{SHORTIO_DOMAIN}/{code}
  shortio_link_id  text not null,         -- short.io 링크 ID(idString) — 통계 조회 키
  utm_campaign     text not null,
  influencer_handle text not null,        -- 핸들 자연키 (draft.influencer_handle 관례)
  draft_id         uuid references draft(id) on delete set null,   -- 선택 연결(원고 삭제돼도 기록 유지)
  client_id        uuid references client(id) on delete set null,
  client_name      text,                  -- 스냅샷 관례(014 선례)
  unavailable_at   timestamptz,           -- short.io 쪽에서 링크가 지워진 것을 확인한 시각. null = 정상
                                          -- (tracked_post.unavailable_at 관례 — 아는 만큼만 말한다)
  created_by       uuid references member(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_tracking_link_draft on tracking_link (draft_id);

-- 클릭은 덮어쓰지 않고 측정마다 한 줄(post_metric_snapshot과 대칭) — short.io에 이력이 있어도
-- 데이터 확인을 위해 서비스를 옮겨다니는 전환 비용이 크고, 다른 데이터와의 관계를 보려면
-- 우리 DB에 있어야 한다(koo 확정, C안).
create table if not exists link_click_snapshot (
  id               uuid primary key default gen_random_uuid(),
  tracking_link_id uuid not null references tracking_link(id) on delete cascade,
  total_clicks     int,                   -- nullable — 출처 결손 허용(지표 스냅샷 관례)
  human_clicks     int,                   -- 봇 제외 클릭(short.io 제공 시)
  raw              jsonb,                 -- 원본 API 응답 — 재수집 없이 재처리(관례)
  captured_at      timestamptz not null default now()
);
create index if not exists idx_link_click_snapshot_latest
  on link_click_snapshot (tracking_link_id, captured_at desc);

-- 클라이언트 기본 랜딩 URL — 링크 생성 폼 자동 채움용, 생성 시 덮어쓰기 가능
alter table client add column if not exists landing_url text not null default '';
