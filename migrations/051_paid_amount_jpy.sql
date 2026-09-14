-- 051: 계좌(일본)·PayPay 지급의 엔화 실지급액(그쪽 09-09 요청 22: paid 완료·정정 POST에 paid_amount_jpy를 paid_amount_krw와 함께 보낸다).
-- 050의 달러(paid_amount_usd)와 짝 — 한 요청에는 외화 하나만 있다(상호 배타). 차액 판정은 종전대로 원화.
alter table payment_request add column if not exists paid_amount_jpy bigint;
