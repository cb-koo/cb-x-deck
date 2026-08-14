-- 027: 콘텐츠 트래킹 — 추적 대상 명부 + 지표 스냅샷(append-only).
-- (026은 cb-koo/influencer-db 브랜치의 026이 프로덕션 DB에 적용돼 있어 건너뜀)
-- 설계: docs/superpowers/specs/2026-08-14-contents-tracking-design.md
create table if not exists tracked_post (
  id             uuid primary key default gen_random_uuid(),
  tweet_id       text not null unique,  -- parseTweetLink 정규화 ID. text = 리포 관례 + JS 정밀도(Snowflake > 2^53)
  author_handle  text,                  -- 작성자 = 인플루언서 (핸들 자연키 — draft.influencer_handle 관례)
  text           text not null default '', -- 등록 시점 본문 스냅샷 — 삭제·수정 후에도 기록 보존
  posted_at      timestamptz,           -- 트윗 게시 시각 — 경과 표기·향후 반응 속도 계산의 기준점
  draft_id       uuid references draft(id) on delete set null, -- 선택 연결(원고 삭제돼도 추적 유지)
  source         text not null default 'manual', -- 'manual' | 'auto'(자동 발견 — 자동화 단계)
  unavailable_at timestamptz,           -- 조회 불가 확인 시각(삭제·비공개·정지). null = 정상.
                                        -- deleted_at이 아닌 이유: 삭제로 단정 못 하는 상태 포함 — 이름도 아는 만큼만
  created_by     uuid references member(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- 지표는 덮어쓰지 않고 측정마다 한 줄 추가(append-only) — v1은 최신만 쓰지만
-- 시계열·바이럴 감지 단계가 이 이력을 그대로 쓴다(스키마 변경 0). 리서치로 통례 검증됨.
create table if not exists post_metric_snapshot (
  id              uuid primary key default gen_random_uuid(),
  tracked_post_id uuid not null references tracked_post(id) on delete cascade,
  views           bigint, -- 전 지표 nullable — 수집기 출처별 결손 허용
  likes int, retweets int, replies int, bookmarks int, quotes int,
  raw             jsonb,  -- 원본 API 응답 — 스키마 진화 시 재수집 없이 재처리(리서치: 통례)
  captured_at     timestamptz not null default now()
);
create index if not exists post_metric_snapshot_latest_idx
  on post_metric_snapshot (tracked_post_id, captured_at desc);
