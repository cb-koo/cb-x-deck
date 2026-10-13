-- 2026년 대한민국 공휴일. 일요일은 클리닉의 요일별 운영 설정을 따른다.
-- 출처: 우주항공청 2026년 월력요항(대체공휴일 포함)
-- https://www.kasa.go.kr/prog/bbsArticle/BBSMSTR_000000000010/view.do?bbsId=BBSMSTR_000000000010&nttId=B000000001860Pe2zT3
-- 노동절·제헌절 추가 지정: 인사혁신처 2026-04-29 보도자료
-- https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&cntId=4250&mode=view&pageIdx=1
-- 지방선거: https://shipvote.nec.go.kr/site/vt/ex/bbs/View.do?bcIdx=298999&cbIdx=1147
-- 현충일·추석의 토요일 중복은 대체공휴일 대상이 아니다.
-- 이후 등록한 임시공휴일 등은 보존하고, 아래 날짜만 공식 명칭으로 보완한다.
insert into holiday_calendar_year (year, names, source)
values (2026, '{
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "삼일절 대체공휴일",
  "2026-05-01": "노동절",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "부처님오신날 대체공휴일",
  "2026-06-03": "전국동시지방선거일",
  "2026-06-06": "현충일",
  "2026-07-17": "제헌절",
  "2026-08-15": "광복절",
  "2026-08-17": "광복절 대체공휴일",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "개천절 대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절"
}'::jsonb, '우주항공청 2026년 월력요항 · 인사혁신처 노동절·제헌절 공휴일 지정 · 중앙선거관리위원회 지방선거 일정')
on conflict (year) do update
set names = holiday_calendar_year.names || excluded.names,
    source = excluded.source,
    fetched_at = now()
where not (holiday_calendar_year.names @> excluded.names);
