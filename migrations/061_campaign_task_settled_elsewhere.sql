-- 061: 다른 곳에서 정산함(koo 2026-09-27) — 앱 밖(구글폼 등)에서 이미 지급을 끝낸 작업의 표시. 추가만, 전 문장 멱등.
-- 계기: 9월1주차는 슬랙+구글폼으로 정산까지 끝났는데, 작업을 덱에 적재하면 정산 후보(게시+비용+인플)가 되어
-- 검토 대기에 올라오고 요청을 또 보낼 수 있다 = 이중 지급 위험. 정산 요청(payment_request)을 만들어 두는 방법은
-- 그쪽 폴링에 잡혀 실제 지급 대기로 넘어가므로 쓰지 않는다(09-09 픽스처 유출과 같은 모양).
-- 표시가 붙은 작업은 정산 후보에서 빠지고(요청 불가), 단계는 '완료'. 비용은 예산·집행액·마케팅 비용 연동에 그대로 잡힌다.
alter table campaign_task
  add column if not exists settled_elsewhere_at      date,                                        -- 표시한 날(서울 DateOnly). null = 표시 없음
  add column if not exists settled_elsewhere_note    text not null default '',                    -- 어디서 정산했는지 한 줄(예: 구글폼)
  add column if not exists settled_elsewhere_by      uuid references member(id) on delete set null,
  add column if not exists settled_elsewhere_by_name text;                                        -- 표시한 사람 이름 스냅샷(payment_request 관례)
comment on column campaign_task.settled_elsewhere_at is '다른 곳에서 정산함 표시일(061). 게시 확인된 살아있는 작업만 — check campaign_task_settled_elsewhere_posted';

-- 게시 확인된·취소 아닌 작업에만. 스토어가 for update 재검사로 막고, 이건 최후 방어다.
-- not valid = 새로 들어오는 행부터만 검사(055 관례). 옛 코드는 이 칸을 쓰지 않고 posted_at을 비우는 경로도 없어 충돌하지 않는다.
alter table campaign_task drop constraint if exists campaign_task_settled_elsewhere_posted;
alter table campaign_task add constraint campaign_task_settled_elsewhere_posted
  check (settled_elsewhere_at is null or (posted_at is not null and cancelled_at is null)) not valid;
