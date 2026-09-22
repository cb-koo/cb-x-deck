-- 057: 정산 정정을 인플루언서 명부(원본)에도 반영 — 그쪽 정정이 요청뿐 아니라 명부 결제 수단까지 함께 고친다.
-- 스펙: docs/superpowers/specs/2026-09-22-settlement-payment-info-roster-autosync-design.md
-- 사용자 결정(2026-09-22): 정정이 "고친 항목만" 명부 수단에 병합한다(수수료·기본 여부·안 고친 항목은 보존). handoff 26 §3의 "명부는 사람이 확인"을 뒤집는다.
-- apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 멱등.

-- 정정 이력(056)에 "이 정정으로 명부를 실제로 고쳤는가"를 함께 남긴다 — 호출 기록의 '명부 반영/확인 필요' 문구와 배포 후 백필의 근거.
-- roster_applied=false + roster_skip_reason: no_method(명부에 수단 없음)·ambiguous(같은 종류 여럿인데 어느 것인지 못 가림)·invalid(patch가 명부 수단과 안 맞음).
alter table payment_request_payment_correction add column if not exists roster_applied boolean not null default false;
alter table payment_request_payment_correction add column if not exists roster_skip_reason text;
comment on column payment_request_payment_correction.roster_applied is '057: 이 정정으로 인플루언서 명부 결제 수단을 실제로 고쳤는지. false면 roster_skip_reason 참고';
comment on column payment_request_payment_correction.roster_skip_reason is '057: 명부에 반영 못 한 사유 — no_method·ambiguous·invalid 중 하나. null = 반영함';

-- influencer_log_event_type_check는 건드리지 않는다 — 명부 반영은 새 이벤트도, 별도 payment_method_changed 줄도 남기지 않는다.
-- 같은 정정의 payment_corrected 한 줄이 "(명부에도 반영했어요/명부는 확인이 필요해요)"로 결과를 말한다(정정 1건이 두 줄로 보이지 않게, 스펙 §2).
