-- 078: 새로 뜨는 검색 [표기 바꾸기] 확인용(10-15) — 바꾸기 전에 '우리 표기 월 N → 새 표기 월 M'을 나란히 보여 준다. 추가만, 재실행 안전.
alter table trend_candidate
  add column if not exists ours_jp     text,  -- 비교한 우리 표기(같은 시술명 묶음에서 가장 큰 것)
  add column if not exists ours_volume int;   -- 그 표기의 최근 3개월 월평균(값 없음이면 null)
