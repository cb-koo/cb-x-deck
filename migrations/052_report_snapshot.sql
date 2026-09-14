-- 028: 마케팅 리포트 — 외부 리포트 API 스냅샷 + 클라이언트↔클리닉 코드 매핑.
-- 설계: docs/superpowers/specs/2026-08-24-marketing-report-design.md
create table if not exists report_snapshot (
  clinic_code  text not null,           -- 외부 API의 clinic 파라미터 값 (예: velybjp)
  granularity  text not null check (granularity in ('day','week','month')),
  period_start date not null,           -- KST 버킷 시작일 (주=월요일, 월=1일)
  period_end   date not null,           -- KST 버킷 종료일 (양끝 포함)
  payload      jsonb not null,          -- 외부 응답 current 원본(전 묶음, 지점 분해 포함) — 파싱은 읽기 쪽 책임
  fetched_at   timestamptz not null default now(),
  primary key (clinic_code, granularity, period_start)
);

-- 클라이언트 ↔ 외부 리포트 클리닉 코드 매핑. null = 리포트 미연동 클라이언트.
alter table client add column if not exists clinic_code text unique;
