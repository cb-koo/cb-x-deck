-- 034: 브릿지 랜딩 이벤트 — append-only 원장. 봇·사람 필터는 저장하지 않고 읽기 시점에 판정한다.
-- 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md
-- 033은 캠페인 관리 브랜치(cb-koo/campaign-management)가 쓰고 있어 건너뜀 — 번호 공백은 적용 스크립트에 무해(026 선례).
create table if not exists landing_event (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null unique,        -- 브릿지가 생성(uuid). 재시도 중복은 여기서 무시된다
  visit_id     text not null,               -- 방문 — arrival/view/tap을 한 사람으로 묶는 열쇠(브릿지 쿠키 1시간)
  kind         text not null check (kind in ('arrival','view','tap')),
  clinic       text not null,
  hostname     text not null,
  path         text not null,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  referer_host text,
  ua           text not null,
  is_bot_ua    boolean not null,            -- 브릿지의 isbot 판정. 전부 저장, 필터는 읽기 시점
  sec_fetch_ok boolean not null,
  ip_hash      text,                        -- sha256(일별 salt + ip) 앞 16자. 원본 IP 없음
  country      text,
  occurred_at  timestamptz not null,        -- 브릿지 시각(ts)
  received_at  timestamptz not null default now()
);
create index if not exists idx_landing_event_content_time on landing_event (utm_content, occurred_at desc);
create index if not exists idx_landing_event_visit on landing_event (visit_id);
create index if not exists idx_landing_event_campaign_time on landing_event (utm_campaign, occurred_at desc); -- 미연결 유입 조회
