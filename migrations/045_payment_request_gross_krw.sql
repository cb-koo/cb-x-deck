-- 045: 실제 송금액의 원화 환산을 생성 컬럼으로. 손으로 채우는 사본이 아니라 DB가 계산한다 — 원본(amount_gross·
-- payout_currency·rate_krw_per_jpy)과 갈릴 수 없고, 값을 직접 쓰려는 UPDATE는 Postgres가 거부한다.
-- bigint + ::bigint 캐스팅으로 int4 상한(약 21억) 우려도 없앤다.
alter table payment_request add column if not exists gross_krw bigint
  generated always as (
    case when payout_currency = 'KRW' then amount_gross::bigint
         else amount_gross::bigint * rate_krw_per_jpy end
  ) stored;
create index if not exists idx_payment_request_gross_krw on payment_request (gross_krw);
