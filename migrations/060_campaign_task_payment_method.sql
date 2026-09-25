-- 060: 작업별 결제 수단(설계 2026-09-23-task-panel-ui-design.md §8-2, koo 결정 "이 작업만")
-- 값은 인플 influencer.payment_methods[].id를 가리키는 참조다 — 스냅샷이 아니다(스냅샷은 정산 요청 때 이미 뜬다).
-- null = 인플의 기본 수단을 따른다. jsonb 안의 id라 FK를 걸 수 없다 — 고른 수단이 나중에 지워지면
-- 읽는 쪽(influencerPayment.taskPaymentMethod)이 기본 수단으로 돌아간다.
-- 칸 추가만(AGENTS.md "마이그레이션과 배포 순서") — 옛 코드는 이 칸을 모르니 무해하고, 1번 머지로 끝난다.
-- 인플이 실제로 바뀔 때 비우는 일은 트리거가 아니라 코드(updateTask·replaceInfluencer)가 한다 —
-- 개명(renameInfluencer)은 같은 사람이라 값을 유지해야 해서 트리거로는 구분할 수 없다.
alter table campaign_task add column if not exists payment_method_id text;
