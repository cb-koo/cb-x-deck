-- 047: 정산 프로덕트가 상태 POST에 실어 보내는 처리 담당자(operator { id, name })를 요청 행에 남긴다.
-- 그쪽 09-04 요청(docs/api/settlement-handoff/11_그쪽_operator요청_20260904.md) — 사람이 실행한 전이(취소·보류·재개·지급·정정)에만 실리고,
-- 자동 전이(수신 즉시 received→scheduled)에는 키가 없다. 마지막으로 적용된 전이의 담당자만 보관한다(이력은 external_api_log 본문에 있다).
-- id는 그쪽 로그인 사용자 UUID라지만 형식을 강제하지 않는다(text) — 그쪽 사정으로 바뀌어도 400을 내지 않기 위해.
alter table payment_request add column if not exists external_operator_id text;
alter table payment_request add column if not exists external_operator_name text;
