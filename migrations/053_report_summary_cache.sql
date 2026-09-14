-- 053 (구 029): 요약 조회 캐시 — 외부 리포트 API가 콜당 ~7초라, 같은 (클리닉·기간) 재조회를 10분간 재사용한다.
create table if not exists report_summary_cache (
  clinic_code text not null,
  period_start date not null,
  period_end   date not null,
  payload      jsonb not null,        -- ReportResponse 원본
  fetched_at   timestamptz not null default now(),
  primary key (clinic_code, period_start, period_end)
);
