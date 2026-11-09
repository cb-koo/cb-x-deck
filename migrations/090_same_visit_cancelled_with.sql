-- 090 같은 방문의 게시물 — 함께 취소 표식(ISSUE-016 검토 반영, koo 11-09).
-- 원래 작업을 취소하면 게시 전 연결 작업도 같은 사유로 함께 취소된다(089). 그 '함께 취소된' 연결 작업에 원래 작업 id를 남겨,
-- 원래 작업을 되돌릴 때 그것만 함께 되돌린다(따로 취소했던 연결 작업은 그대로 둔다). 되돌리면 비운다.
-- FK를 두지 않는 이유: 표식일 뿐이고, 원래 작업을 지울 땐 연결 작업이 먼저 지워진다(deleteTask) — 참조 무결성이 지킬 것이 없다.
-- 추가만 한다(옛 코드는 이 칸을 모르니 무해, AGENTS.md 마이그레이션 규칙). 전 문장 멱등.
alter table campaign_task add column if not exists cancelled_with uuid;
comment on column campaign_task.cancelled_with is
  '함께 취소된 원래 작업 id(090). 원래 작업 취소 때 같이 취소된 같은 방문 연결 작업에만 채운다 — 원래 작업 되돌리기가 이것만 함께 되돌린다';
