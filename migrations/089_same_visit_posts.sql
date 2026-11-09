-- 089 같은 방문의 게시물(ISSUE-016, koo 11-09) — 방문협찬 한 번에 인플이 게시물을 여러 개 올리는 경우.
-- 방문 한 번 = 묶음 가격이라 금액은 원래 작업 하나에만 두고, 두 번째 게시물부터는 '연결 작업'(비용 없음 고정)으로 만든다.
-- same_visit_of = 같은 방문의 원래 작업. 비어 있으면 일반 작업. 연결 작업은 예약·방문 수·정산 후보에서 빠지고,
-- 게시물 수·성과에는 들어간다(CPV는 원래 작업 비용을 게시물 수로 나눈다).
-- 추가만 한다(옛 코드는 이 칸을 모르니 무해, AGENTS.md 마이그레이션 규칙). 전 문장 멱등.
alter table campaign_task add column if not exists same_visit_of uuid;
comment on column campaign_task.same_visit_of is
  '같은 방문의 원래 작업(089). 연결 작업은 방문협찬·비용 없음 고정. 원래 작업만 지우면 FK가 막는다 — 앱이 확인 후 연결 작업을 먼저 지워 삭제 기록에 남긴다';
-- FK는 이름을 붙여 따로 — 재실행해도 같은 모양(drop → add). on delete는 기본(no action): 문장 끝에 검사하므로
-- 캠페인 삭제처럼 원래 작업·연결 작업이 한 문장에서 함께 지워지는 경우는 통과하고, 원래 작업만 지우면 막는다(조용한 연쇄 삭제 없음).
-- restrict는 행마다 즉시 검사라 캠페인 삭제의 삭제 순서에 따라 실패할 수 있어 쓰지 않는다.
alter table campaign_task drop constraint if exists campaign_task_same_visit_of_fkey;
alter table campaign_task add constraint campaign_task_same_visit_of_fkey
  foreign key (same_visit_of) references campaign_task(id) not valid;

-- 연결 작업 = 방문협찬 + 비용 없음 + 자기 자신이 아님. 체인 금지(원래 작업이 연결 작업이 아님)는 칸 사이 비교라 앱이 막는다.
-- not valid = 새로 들어오거나 바뀌는 행부터만 검사(036·040·048·055 관례). 기존 행은 전부 null이라 안전하다.
alter table campaign_task drop constraint if exists campaign_task_same_visit_shape;
alter table campaign_task add constraint campaign_task_same_visit_shape
  check (same_visit_of is null or (same_visit_of <> id and type = 'visit' and no_cost and cost is null)) not valid;

create index if not exists idx_campaign_task_same_visit_of on campaign_task (same_visit_of) where same_visit_of is not null;
