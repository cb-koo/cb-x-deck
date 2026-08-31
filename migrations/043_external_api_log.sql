-- 043: 외부 정산 API 호출 기록(성공·거부 모두). 본문은 저장하지 않는다 — 판정에 필요한 조각만.
create table if not exists external_api_log (
  id          uuid primary key default gen_random_uuid(),
  at          timestamptz not null default now(),
  method      text not null,
  path        text not null,
  request_id  uuid,                  -- 경로에서 뽑은 값(있을 때만). FK 없음 — 없는 id로 온 호출도 기록해야 한다
  status_code int  not null,
  outcome     text not null,
  detail      text,                  -- 거부 이유(잘못된 필드 이름·conflict code 등)
  sent_status text,                  -- POST 본문의 status 값(received/scheduled/paid/on_hold/cancelled)
  query       text,                  -- GET의 쿼리스트링 요약(커서 문제 진단용)
  ip          text,
  user_agent  text
);
alter table external_api_log drop constraint if exists external_api_log_outcome_check;
alter table external_api_log add constraint external_api_log_outcome_check
  check (outcome in ('ok','applied','stale','unauthorized','bad-request','not-found','conflict','error'));
create index if not exists idx_external_api_log_at on external_api_log (at desc);
