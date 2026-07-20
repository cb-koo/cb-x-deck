-- 외부 API 호출 사용량 기록. 비용은 저장하지 않고 조회 시 단가로 계산.
create table if not exists api_usage (
  id uuid primary key default gen_random_uuid(),
  api text not null,             -- getxapi | exa | anthropic
  operation text not null,       -- getxapi.search, anthropic.suggest, ...
  ok boolean not null default true,
  http_status int,
  model text,                    -- anthropic만
  input_tokens int,              -- anthropic만
  output_tokens int,             -- anthropic만
  units int not null default 1,  -- 요청/검색 수
  created_at timestamptz not null default now()
);
create index if not exists api_usage_created_at_idx on api_usage (created_at);
create index if not exists api_usage_api_idx on api_usage (api);
