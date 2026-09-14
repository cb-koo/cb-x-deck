-- 049: 개정 이력에 "정산 담당자 확인" 여부(09-07 그쪽과 합의: 그쪽이 처리한 건을 고칠 때는 슬랙으로 담당자 확인 후 반영).
-- 확인은 사람 사이의 대화라 API로 검증할 수 없다 — 우리가 남길 수 있는 것은 "확인했다고 표시하고 고쳤다"는 기록이다.
alter table payment_request_revision add column if not exists partner_confirmed boolean not null default false;
