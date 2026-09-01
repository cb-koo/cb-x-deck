-- 046: 정산 프로덕트가 보낸 결과를 잃지 않게 한다 (스펙 2026-09-01-settlement-partner-result-design.md §3)
-- 새 표는 만들지 않는다 — 실지급액·지급 시각·메모·그쪽 상태는 041이 payment_request에 이미 넣었다.

-- 그쪽이 보낸 본문 원문(파싱 전). jsonb가 아니라 text다: JSON이 깨져 400으로 거부된 본문이야말로
-- 가장 보고 싶은 것인데 jsonb에는 들어가지 않는다. 4KB 상한은 앱에서 잘라 넣는다.
alter table external_api_log add column if not exists body text;

-- 차액 확인 — 실지급액이 실제 송금액(gross_krw)과 다를 때 담당자가 확인했다는 표시.
-- 사유 칸은 없다(koo 결정 09-01: 사유는 정산 쪽 메모만 쓴다). 확인한 사람은 이름 스냅샷만 남긴다(cancelled_by_name 선례).
alter table payment_request add column if not exists diff_ack_at timestamptz;
alter table payment_request add column if not exists diff_ack_by_name text;
