-- 088 '기타 협찬' 작업 유형(ISSUE-002·015, koo 11-06) — X 게시물이 아닌 협찬(구글맵 리뷰, 상담회 참석 등).
-- 완료일은 posted_at, 확인 링크(아무 사이트)는 post_url을 그대로 쓴다 — 정산 후보·자동 전송·같은 주 함께 보내기·
-- 마케팅 비용 귀속일이 고칠 것 없이 따라온다. 새 칸은 둘:
--   other_kind: 무엇을 했는지 한 줄(기타 협찬만, 완료 확인 때 필수 — 나중에 별도 유형으로 옮길 때의 기준)
--   done_note : 링크 없이 완료한 건의 확인 메모(정산 요청 note에 '[링크 없음] …'으로 실린다)
-- 추가만 한다: 칸 추가 + 허용 값 넓히기. 옛 코드가 넣던 값은 그대로 통과한다(AGENTS.md 마이그레이션 규칙, 머지 1번).
-- 제약 교체는 drop if exists → add(멱등), not valid는 관례(036·040·048·055) — 넓히는 제약이라 기존 행은 어차피 통과한다.
alter table campaign_task add column if not exists other_kind text not null default '';
alter table campaign_task add column if not exists done_note  text not null default '';

alter table campaign_task drop constraint if exists campaign_task_type_check;
alter table campaign_task add constraint campaign_task_type_check
  check (type in ('post', 'quoteRt', 'rt', 'visit', 'other')) not valid;

alter table payment_request drop constraint if exists payment_request_task_type_check;
alter table payment_request add constraint payment_request_task_type_check
  check (task_type in ('post', 'quoteRt', 'rt', 'visit', 'other')) not valid;
