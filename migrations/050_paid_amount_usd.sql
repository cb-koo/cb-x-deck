-- 050: PayPal 지급의 달러 실지급액(그쪽 09-09: paid 완료·정정 POST에 paid_amount_usd를 paid_amount_krw와 함께 보낸다).
-- 보관·표시·되비침용. 차액 판정은 종전대로 원화(gross_krw vs paid_amount_krw)로만 한다 — 환율은 그쪽 몫.
alter table payment_request add column if not exists paid_amount_usd numeric(12,2);
