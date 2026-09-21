-- 056: 정산 프로덕트(미러)가 보내는 "수취 정보(결제 수단) 정정" 회신 — 그쪽 09-21 요청(docs/api/settlement-handoff/26_…).
-- 스펙: docs/superpowers/specs/2026-09-21-settlement-payment-info-correction-design.md
-- 정정은 같은 요청의 payment_method(스냅샷)만 바꾼다 — revision·금액·그쪽 처리 상태·정산코드는 건드리지 않는다.
-- 그래서 개정 이력 표(payment_request_revision, unique (request_id, revision))를 쓰지 못하고 별도 표를 둔다 — 멱등(같은 정정 재전송) 판정도 이 표가 한다.
-- apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 멱등.

-- 마지막 정정 표식 — 그쪽 API Item의 payment_method_correction(§5)과 우리 화면 "정산 쪽이 수취 정보를 정정했어요"의 출처.
-- 모양: { correction_id, at, by_id, by_name, reason }. null = 정정된 적 없음(또는 그 뒤 우리가 제자리 수정으로 명부 값을 다시 덮음).
alter table payment_request add column if not exists payment_method_correction jsonb;
comment on column payment_request.payment_method_correction is '정산 쪽이 마지막으로 보낸 수취 정보 정정(056). { correction_id, at, by_id, by_name, reason }. 제자리 수정(reviseRequest)이 결제 수단을 다시 스냅샷하면 null로 되돌린다';

create table if not exists payment_request_payment_correction (
  id               uuid primary key,                       -- 그쪽이 발급한 correction_id(회신 상관관계·멱등 키)
  request_id       uuid not null references payment_request(id) on delete cascade,
  idempotency_key  text,                                   -- 그쪽 재전송 안전 키(선택). 같은 요청 안에서 유일
  base_revision    int  not null,                          -- 정정이 기준한 우리 revision(그쪽 base_source_revision)
  patch            jsonb not null,                         -- 그쪽이 보낸 바뀐 키만(snake_case 그대로)
  before           jsonb not null,                         -- 정정 전 payment_method 스냅샷
  after            jsonb not null,                         -- 정정 후 payment_method 스냅샷
  reason           text not null,
  operator_id      text not null,                          -- 047과 같은 규약: 형식 강제 없음(text)
  operator_name    text not null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_payment_request_payment_correction_request on payment_request_payment_correction (request_id, created_at);
create unique index if not exists idx_payment_request_payment_correction_idem
  on payment_request_payment_correction (request_id, idempotency_key) where idempotency_key is not null;

-- 활동 기록에 '정산 쪽 수취 정보 정정' 이벤트를 허용한다(055의 목록 + payment_corrected). 재실행 안전(drop if exists → add).
-- 마지막 파일이라 not valid를 붙이지 않는다(새 행은 검사된다). 뒤에 이벤트를 또 넓히는 파일이 생기면 이 문장에 not valid를 붙일 것(036·048·055 관례).
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed',
                        'payment_method_changed','payment_requested','payment_cancelled','payment_paid','payment_revised','task_declined','payment_corrected'));
