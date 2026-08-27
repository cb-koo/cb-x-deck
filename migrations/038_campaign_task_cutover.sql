-- 038: 캠페인 작업 전환 마무리 — draft의 캠페인 3컬럼 drop (스펙 §2-2 ④)
-- 반드시 (1) 037 적용 → (2) scripts/cutover-campaign-task.ts 실행 → (3) 새 코드 배포 → 뒤에 적용한다.
-- 새 코드는 이 컬럼들을 읽지 않으므로 늦게 적용해도 무해하고, 일찍 적용하면 옛 코드가 500이 난다.
drop index if exists idx_draft_campaign;
alter table draft drop column if exists campaign_id;
alter table draft drop column if exists scheduled_on;
alter table draft drop column if exists cost;
