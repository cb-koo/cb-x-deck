-- 040: 정산 결제 요청 (스펙 2026-08-28-settlement-page-design §2)
-- main 최신 039(캠페인 작업 전환 마무리) → 040. apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 멱등.

-- §2-1 요청 1건 = 행 1개. 만든 시점 스냅샷 — 이후 인플 결제 수단·작업 비용이 바뀌어도 이 행은 그대로.
create table if not exists payment_request (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid references campaign_task(id) on delete set null,   -- 작업이 지워져도 요청 기록은 남는다
  campaign_id         uuid references campaign(id) on delete set null,
  campaign_name       text not null,
  client_id           uuid references client(id) on delete set null,          -- 정산 쪽에 ID+이름 동봉
  client_name         text not null,
  influencer_handle   text not null,                                          -- 표기 보존
  task_type           text not null check (task_type in ('post','quoteRt','rt','visit')),
  category            text not null,                                          -- 양식 '분류' = 옵션의 정산 쪽 이름(sendAs)
  category_default    text,                                                   -- 화면이 미리 채웠던 값(사람이 바꿨는지 추적)
  item_text           text not null,
  purpose_text        text not null,
  amount_krw          int not null,
  cost_currency       text not null check (cost_currency in ('KRW','JPY')),
  payout_currency     text not null check (payout_currency in ('KRW','JPY')),
  rate_krw_per_jpy    int not null,
  amount_net          int not null,
  fee                 jsonb,                                                  -- 결제 수단 fee 스냅샷. null = 인플 부담
  fee_amount          int not null default 0,
  amount_gross        int not null,                                           -- net + fee = 실제 송금액 = 양식 '금액'
  deadline_on         date not null,
  reference_url       text,
  payment_method      jsonb not null,                                         -- 결제 수단 스냅샷(type·holder·currency·식별값)
  requester_member_id uuid references member(id) on delete set null,
  requester_name      text not null,
  status              text not null default 'requested' check (status in ('requested','cancelled')),
  cancelled_at        timestamptz,
  cancelled_by        uuid references member(id) on delete set null,
  cancelled_by_name   text,
  cancel_reason       text,
  sent_at             timestamptz,                                            -- 송신 작업이 채운다(이번엔 항상 null)
  external_id         text,
  note                text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()                      -- 트리거 없음 — 스토어가 now() 수동 갱신
);
-- 작업당 활성 요청 1건 — 두 사람이 동시에 눌러도 DB가 막는다(koo 08-28). 취소 후 재요청은 허용.
create unique index if not exists idx_payment_request_active_task
  on payment_request (task_id) where status = 'requested';
create index if not exists idx_payment_request_created on payment_request (created_at desc);
create index if not exists idx_payment_request_handle on payment_request (lower(influencer_handle));
create index if not exists idx_payment_request_campaign on payment_request (campaign_id);

-- §2-2 설정은 버전 행(prompt_template_version 021과 같은 문법) — 마지막 행이 현재값
create table if not exists settlement_setting_version (
  id         uuid primary key default gen_random_uuid(),
  settings   jsonb not null,
  member_id  uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);

-- §2-3 인플 활동 기록 이벤트 추가 — 제약 이름은 036과 동일(drop + add)
-- not valid: apply-migrations.sh가 전 파일을 재실행한다 — 뒤 마이그레이션이 넓힌 이벤트 값이 이미 쌓여 있어도 옛 목록으로 재생성할 때 실패하지 않게. 새 행은 검사된다. 마지막 파일(현재 040)의 목록이 실효 제약.
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed',
                        'payment_method_changed','payment_requested','payment_cancelled')) not valid;
