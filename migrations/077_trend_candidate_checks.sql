-- 077: 새로 뜨는 검색 후보 정합성(10-15) — 추가만(옛 코드는 새 칸을 모른다). 재실행 안전.
-- 키워드 플래너가 오타를 원래 이름과 한 묶음으로 같은 숫자를 줘서(ボットクス = ボトックス) '이미 세는 검색'이 새 후보로 올라온 일이 계기.
alter table trend_candidate
  add column if not exists first_month   text,  -- 처음 찾은 달(YYYY-MM)
  add column if not exists rising_months int,   -- 지난달부터 거꾸로 몇 달째 1년 전보다 늘어난 상태인지(3개월 평균 기준)
  add column if not exists action        text,  -- 다른 표기 처리: 'add'(더하기) · 'replace'(우리 표기보다 훨씬 커서 표기 바꾸기)
  add column if not exists korea         int,   -- '韓国 + 후보' 검색 월평균(한국 클리닉 관련성)
  add column if not exists serp          jsonb; -- 일본 사이트 검색 결과 구성 {derm,med,self,unrelated,note}
update trend_candidate set first_month = found_month where first_month is null;

-- 시술별 연관 검색어를 넓힐 때 나온 '우리 목록 밖' 검색어 중 늘어난 것만 모아 두는 곳 — 새로 뜨는 검색 찾기가 넓은 검색어 결과와 합쳐 쓴다(시작점 20개 → 시술 전체).
create table if not exists trend_orphan (
  market   text not null default 'jp',
  norm     text not null,
  text     text not null,
  series   int[] not null,
  series_start date not null,
  seen_at  timestamptz not null default now(),
  primary key (market, norm)
);
alter table trend_orphan enable row level security;
