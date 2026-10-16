-- 079: '값 없음' 시술의 다른 표기 후보(10-17) — 키워드 플래너가 시술명 검색량을 주지 않는 시술(エラボトックス 등)에, 같은 뜻인데 값이 나오는
-- 다른 말(咬筋ボトックス·ホクロ取り)을 찾아 사람이 더한다. 추가·넓히기만 한다 — 옛 코드는 새 종류 'alt'를 쓰지도 읽지도 않는다. 재실행 안전.
alter table trend_candidate drop constraint if exists trend_candidate_kind_check;
alter table trend_candidate add constraint trend_candidate_kind_check
  check (kind in ('new', 'variant', 'concern', 'self', 'clinic', 'other', 'alt')) not valid;
alter table trend_candidate
  add column if not exists match jsonb;  -- 같은 시술 확인: 일본 사이트 상위 결과 중 {same, other, self, unrelated, total, note}
alter table trend_procedure
  add column if not exists alt_checked_at timestamptz;  -- 다른 표기를 마지막으로 찾은 때(값 없음 시술만, 90일마다)
