# 시간대 통일 조사 — `main` 기준 전수 분류

- 조사 대상: `/Users/koo_clinicbridge/cb-x-deck`, 브랜치 `main`, HEAD `73948c9`
- 범위: `src/**/*.ts`, `src/**/*.tsx` 전체 (`src/lib`, `src/components`, `src/app` — API 라우트·SQL 문자열 포함)
- 읽기 전용 조사. 코드 변경·테스트·빌드 실행 없음.
- 전제: 사용자=한국, Postgres 서버=UTC, 수집 트윗=주로 일본. 한국은 1988년 이후 DST 없음 → KST 고정 +9.

집계: **(A) 10 · (B) 6 · (C) 18 · (D) 40+ (파일 21개)**

---

## 1. (A)/(B) — 실제 작업 대상

### (A) 표시가 UTC 또는 브라우저 로컬

| # | file:line | 식 | 판정 근거 |
|---|---|---|---|
| A1 | `src/lib/format.ts:23` | `` `'${String(d.getUTCFullYear()).slice(2)}.${pad(d.getUTCMonth()+1)}.${pad(d.getUTCDate())}` `` | `formatDate(iso)`가 instant를 UTC 달력으로 렌더. 09:00 KST 이전에는 전날로 보인다. 이 파일이 UTC 표시의 근원. |
| A2 | `src/components/TweetCard.tsx:252` | `수집 {formatDate(t.firstSeenAt)} · 갱신 {formatDate(t.lastFetchedAt)}` | A1 호출부. `first_seen_at`·`last_fetched_at`은 `migrations/001_init.sql:24-25`에서 `timestamptz` → instant 확정. |
| A3 | `src/app/w/[wsId]/research/page.tsx:125` | `{new URL(r.url).hostname} · {formatDate(r.publishedDate)}` | A1 호출부. `publishedDate`는 Exa 응답의 ISO instant(`src/lib/exa.ts:58`, 픽스처 `2026-06-01T00:00:00.000Z`) — 시각 성분이 있는 instant. |
| A4 | `src/components/TweetCard.tsx:21-22` | `const d = new Date(iso); return `${d.getMonth()+1}월 ${d.getDate()}일`` | `timeAgo`의 **폴백 분기만** (A). `s < 3600` / `s < 86400` 두 분기는 초 차이 계산이라 (D). 24시간 넘으면 브라우저 로컬 달력으로 떨어진다 — 한국에선 맞지만 고정되어 있지 않다. |
| A5 | `src/components/QuotedCard.tsx:8-9` | `const d = new Date(iso); ... d.getMonth()+1 / d.getDate()` | `shortDate(e.tweetCreatedAt)` (`:35`). `tweet_created_at`은 `migrations/001_init.sql:23` `timestamptz`. 로컬 게터 — 미고정. |
| A6 | `src/components/PillarPanel.tsx:9-10` | `const d = new Date(iso); return `${d.getMonth()+1}/${d.getDate()}`` | `fmtDay` — 호출부 두 곳 모두 instant다. `analyzedAt`은 `migrations/006_pillar.sql:7` `analyzed_at timestamptz`, `samplePeriod`는 `src/app/api/columns/[id]/pillar/route.ts:22,28`에서 `tweet_created_at`(timestamptz) ISO를 정렬해 만든 [최고, 최신] 쌍. 로컬 게터 — 미고정. |
| A7 | `src/lib/draftUi.ts:24-25` | `const d = new Date(iso); return `${d.getMonth()+1}월 ${d.getDate()}일`` | `draftTimeLabel`의 **폴백 분기만** (A). `방금`/`N분`/`N시간` 세 분기는 (D). `draft.created_at`은 `migrations/014_content_generator.sql:9` `timestamptz`. **§7 별도 항목 참조 — 이 파일은 다른 워크스트림이 수정 중.** |
| A8 | `src/components/CandidateCard.tsx:91` | `{new Date(e.savedAt).toLocaleDateString('ko-KR')}` | `candidate.saved_at`은 `migrations/001_init.sql:41` `timestamptz`. `toLocaleDateString`은 **브라우저** 로컬 — 한국 사용자에겐 맞지만 서버 렌더/해외 접속 시 어긋난다. 미고정. |
| A9 | `src/lib/usageStore.ts:66` | `to_char(date_trunc('day', created_at at time zone 'Asia/Tokyo'), 'YYYY-MM-DD')` | **출력은 이미 정확하다** — Asia/Tokyo는 Asia/Seoul과 같은 +9이고 둘 다 DST 없음. 이름만 오도한다. `Asia/Seoul`로 바꿔도 **출력 변화 0**. 다만 §6의 경계 불일치와 세트로 봐야 한다. |
| A10 | `src/components/BriefingSection.tsx:33-36` | `const d = new Date(Date.parse(iso) + 9*3_600_000); ... getUTCMonth()/getUTCDate()` | `fmtDayJst` — 수동 +9 시프트 후 UTC 게터. **출력은 이미 KST로 정확**하고 A9과 같은 성격(이름만 JST). `briefing.created_at`(`migrations/008_briefing.sql:12` timestamptz)에 적용. 공용 헬퍼로 흡수해야 할 중복. |

### (B) '오늘'/기간 경계를 UTC로 계산

| # | file:line | 식 | 판정 근거 |
|---|---|---|---|
| B1 | `src/app/w/[wsId]/usage/page.tsx:20-24` | `const to = new Date(); const from = new Date(to); ... from.setDate(1); from.setHours(0,0,0,0)` | 서버 로컬(Vercel=UTC)에서 기간 경계를 만든다. `'month'`가 최악: ① 경계가 1일 00:00 UTC = 1일 09:00 KST라 매월 1일 오전 9시간치가 '이번 달'에서 빠지고, ② 한국 시간 1일 00:00~09:00 사이에 열면 서버 UTC 날짜가 아직 전월 말일이라 `setDate(1)`이 **전달 1일**을 가리킨다. `'7d'`/`'30d'`도 UTC 자정 기준이라 일별 막대의 양 끝이 잘린다. |
| B2 | `src/lib/actualCost.ts:47` (+ 사용 `:58`) | `function ymd(d: Date) { return d.toISOString().slice(0,10) }` → `?start_date=${ymd(from)}&end_date=${ymd(to)}` | Exa admin API의 **쿼리 파라미터**를 UTC 날짜로 만든다. B1의 `from`/`to`를 그대로 받으므로 오차가 합성된다. (`:64-65`의 `periodStart`/`periodEnd`는 화면에 렌더되지 않는다 — `ActualCostPanel.tsx`가 쓰지 않음. `:79` 캐시 키는 (D).) |
| B3 | `src/components/BriefingSection.tsx:450` | `{ sinceDate: preview.since, untilDate: new Date().toISOString().slice(0,10) }` | 백필 재수집의 **쿼리 파라미터**(X 검색 `until:`). 00:00~09:00 KST에 누르면 어제가 되어 그날치 수집 범위가 빠진다. `sinceDate`는 date-only weekStart라 (C) — 한 객체 안에 (B)와 (C)가 섞여 있다. |
| B4 | `src/components/TrendPanel.tsx:40` | `{ sinceDate: data.weekly[0].weekStart, untilDate: new Date().toISOString().slice(0,10) }` | B3과 동일한 백필 경로의 복제본. |
| B5 | `src/components/TweetTableView.tsx:208` | `date: new Date().toISOString().slice(0,10)` → `csvFileName({...})` | CSV **파일명**의 날짜. 00:00~09:00 KST에 내보내면 파일 이름이 어제 날짜가 된다. |
| B6 | `src/app/api/research/density/route.ts:14` | `const since = new Date(Date.now() - 7*86400_000).toISOString().slice(0,10)` → `since:${since}` | X 검색 `since:` **쿼리 파라미터**를 UTC 날짜로 자른다. 밀도 프로브의 '최근 7일' 창이 한국 시간 기준으로 하루 밀린다. |

---

## 2. (C) — 만지면 안 되는 곳 (날짜 전용 값의 올바른 왕복)

각 항목의 "고치면 깨지는 것"을 함께 적는다. 공통 원리: 값이 `YYYY-MM-DD` **date-only**이므로 `...T00:00:00Z` + `getUTC*` 왕복은 시간대 무관하게 원본을 그대로 되돌린다. 여기에 +9를 더하면 09:00 KST가 되어 `getUTC*`가 여전히 같은 날을 주지만, KST 게터/`Intl`로 바꾸면 **하루 밀린다**.

| # | file:line | 값 | 고치면 깨지는 것 |
|---|---|---|---|
| C1 | `src/lib/trend.ts:33-35` | `weekStartJst` — instant를 +9 시프트해 JST/KST 달력의 월요일 date-only를 만든다 | 이미 +9다. 여기에 시프트를 더하면 **모든 주 버킷이 한 주씩 밀린다**. 추이 패널·브리핑·주제 추이가 전부 이 함수 하나에 매달려 있다. 회귀 테스트 `trend.test.ts:17-23`이 경계 5건을 고정하고 있다. |
| C2 | `src/lib/trend.ts:39` | `addWeeks(weekStart, n)` — date-only ± 7일 | date-only 산술. KST 파싱으로 바꾸면 `2026-07-13`이 `2026-07-12`가 되어 8주 슬롯 전체가 어긋난다. |
| C3 | `src/lib/briefing.ts:25` | `toDisplay: new Date(Date.parse(toExclusive+'T00:00:00Z') - DAY_MS).toISOString().slice(0,10)` | 마지막 완성 주의 일요일. +9를 넣으면 토요일이 되어 브리핑 헤더 기간이 하루 짧아진다. `briefing.test.ts:31-36`이 `2026-07-12`로 고정. |
| C4 | `src/lib/briefing.ts:100-101` | `new Date(w.weekStart+'T00:00:00Z')` → `getUTCMonth()/getUTCDate()` | `weekStart`는 C1이 만든 date-only. 주차 라벨 `1주차(6/15~)`가 `6/14~`로 밀린다. 이 문자열은 **LLM 프롬프트에 들어가는 확정 수치**라 밀리면 보고서 본문의 날짜가 틀린다. |
| C5 | `src/lib/briefing.ts:165` | `(Date.parse(w+'T00:00:00Z') - Date.parse(periodFrom+'T00:00:00Z')) / (7*86_400_000)` | 두 date-only의 차. 한쪽에만 시프트가 들어가면 주차 인덱스가 어긋나고, `Math.floor` 때문에 경계에서 ±1이 튄다. |
| C6 | `src/components/BriefingSection.tsx:27-30` | `fmtDay(s)` = `new Date(s+'T00:00:00Z')` + `getUTC*` | 인자가 `current.periodFrom`/`periodTo`(`:554`, `:643`). `migrations/008_briefing.sql:6-7`에서 `period_from date`/`period_to date`이고 `briefingStore.ts:43,57`이 `to_char(..., 'YYYY-MM-DD')`로 문자열화한다 → **date-only 확정**. 고치면 브리핑 목록의 기간이 전부 하루씩 앞당겨진다. |
| C7 | `src/components/BriefingSection.tsx:39-44` | `fmtWeekRange(weekStart)` — `+6*86_400_000` 후 `getUTC*` | 주 범위 `6/15~21`. date-only 산술이라 손대면 `6/14~20`. |
| C8 | `src/components/TrendPanel.tsx:9-12` | `fmtWeek(weekStart)` — 같은 패턴 | 추이 막대 x축 라벨이 한 칸씩 밀린다. C6/C7과 코드가 사실상 동일 — 공용화하더라도 **date-only 전용 함수**로 묶어야 한다. |
| C9 | `src/lib/tableFilter.ts:62-67` | `isValidCalendarDate` — `Date.UTC(y,m-1,d)` 왕복으로 `2026-13-40` 검출 | 굴림(rollover) 검출 그 자체가 목적. 시간대를 넣으면 `2026-03-01`처럼 경계 날짜가 `02-28`로 되돌아와 **유효한 날짜를 거부**하거나, 반대로 무효 날짜가 통과해 `$1::date`에서 Postgres가 던지고 라우트에 try/catch가 없어 500이 된다(주석 `:60-62`가 이 사고를 명시). |
| C10 | `src/lib/tableFilter.ts:117-118` | `` `${expr} >= ${bind(v)}::date::timestamp at time zone 'Asia/Seoul'` `` | **이미 정확한 정답 코드다.** 2026-07-31 실측으로 고쳐진 곳. 여기에 JS 쪽 +9를 추가로 얹으면 경계가 KST 09:00이 되어 '이후' 필터가 그날 오전 글을 다시 버린다. `tableFilter.test.ts:166-170`이 SQL 문자열을 정규식으로 고정하고 있다. |
| C11 | `src/lib/tableFilter.ts:55,79-80` | `DATE_RE`/`isComplete`의 date-only 검증 | 사용자가 `<input type="date">`로 넣은 date-only. 파싱/포맷 개입 불필요. |
| C12 | `src/lib/briefingStore.ts:43,57` | `to_char(b.period_from,'YYYY-MM-DD')` | `date` 컬럼을 문자열로 뽑아 드라이버의 Date 변환을 우회하는 것이 **의도된 방어**다. 이걸 없애고 Date 객체로 받으면 postgres.js가 로컬 자정으로 해석해 하루가 튄다. |
| C13 | `src/lib/collectionConflict.ts:96-121` | `cfg.sinceDate! > v`, `.sort()[0]` 등 date-only **사전식 비교** | `YYYY-MM-DD`는 사전식 정렬이 곧 시간순이라 Date 변환이 필요 없다. Date로 바꾸면 시간대 문제가 새로 생기고, `until:` 포함/미포함 경계 규칙(`:111-118`)이 무너진다. |
| C14 | `src/lib/queryBuilder.ts:12-13` | `since:${c.sinceDate}` / `until:${c.untilDate}` | 사용자가 컬럼 설정에 직접 넣은 date-only를 X 검색 연산자에 그대로 넘긴다. X의 `since:`/`until:`은 date-only를 받는다 — 변환하면 안 된다. |
| C15 | `src/components/ColumnSettings.tsx:222,224` | `<input type="date" value={sinceDate}>` | HTML date input의 값은 정의상 date-only. |
| C16 | `src/lib/usageStore.ts:108-111` + `UsageBar.tsx:12,16,24` | `summarizeByDay`의 `day` 키, `d.day.slice(5)` | `day`는 A9의 `to_char`가 만든 date-only 문자열. 표시 쪽은 이미 옳다 — A9의 SQL 이름만 바꾸면 되고 여기는 건드릴 필요가 없다. |
| C17 | `src/lib/briefing.ts:29-34` | `filterPeriod`: `w >= from && w < toExclusive` (date-only 사전식) | C13과 같은 원리. |
| C18 | `src/lib/trend.ts:128-129` | `w >= recentFrom && w < currentWeek` (date-only 사전식) | 주 버킷 격주 비교. C13과 같은 원리. |

---

## 3. (D) 사이트 — 파일별 개수

사용자에게 달력 날짜로 도달하지 않는 것들(전송용 `toISOString()`, DB에 쓰는 `now()`, 정렬 키, 캐시 키, 타이머, 초 차이 기반 상대 라벨).

| 파일 | 개수 |
|---|---|
| `src/lib/tweetStore.ts` | 7 |
| `src/lib/candidateStore.ts` | 5 |
| `src/lib/pillarStore.ts` | 4 |
| `src/app/generate/page.tsx` | 3 |
| `src/components/TweetCard.tsx` (timeAgo 단기 분기) | 3 |
| `src/lib/draftUi.ts` (`:20` 초차이, `:64` `Date.parse` 비교) | 2 |
| `src/lib/useDeckDrag.ts` | 2 |
| `src/components/Column.tsx` (`:19` 상대 라벨 전 분기, `:165`) | 2 |
| `src/lib/columnStore.ts` | 2 |
| `src/lib/candidateGroups.ts` (`localeCompare` 정렬 키) | 2 |
| `src/app/debug/card/page.tsx` | 2 |
| `src/lib/actualCost.ts` (`:79` 캐시키, `:81/:93` TTL) | 2 |
| `src/lib/mappers.ts` | 1 |
| `src/lib/draftStore.ts` | 1 |
| `src/lib/referenceStore.ts` | 1 |
| `src/lib/scoutStore.ts` | 1 |
| `src/lib/briefingStore.ts` (`:23` created_at 전송) | 1 |
| `src/lib/quotedStore.ts` | 1 |
| `src/lib/translationStore.ts` | 1 |
| `src/app/api/briefings/route.ts` (`:34` 전체 instant를 nowIso로) | 1 |
| `src/app/api/columns/[id]/trend/route.ts` (`:16` 동일) | 1 |
| **합계** | **45 (21개 파일)** |

주: `src/app/api/briefings/route.ts:34`·`trend/route.ts:16`의 `new Date().toISOString()`은 **날짜로 자르지 않은 완전한 instant**이고 하류의 `weekStartJst`가 +9 변환을 책임지므로 (B)가 아니다. `.slice(0,10)`이 붙는 순간 (B)가 된다 — 이 구분이 (B) 판정의 실제 기준선이다.

---

## 4. 공용 헬퍼 현황

### 지금 존재하는 것 (7개, 서로 모름)

| 헬퍼 | 위치 | 입력 | 시간대 | 호출부 | 테스트 |
|---|---|---|---|---|---|
| `formatDate` | `src/lib/format.ts:19` | instant | **UTC (틀림)** | `TweetCard.tsx:252`(×2), `research/page.tsx:125` | `format.test.ts:26-28` |
| `ymd` | `src/lib/tableColumns.ts:56` | instant | **KST +9 고정 (맞음)** | `tableColumns.ts:80,95`, `TweetCardModal.tsx:249` | `tableColumns.test.ts:44` |
| `ymdHm` | `src/lib/tableColumns.ts:64` | instant | **KST +9 고정 (맞음)** | `tableColumns.ts:85,100`, `TweetCardModal.tsx:249` | `tableColumns.test.ts:54` |
| `timeAgo` | `src/components/TweetCard.tsx:16` | instant | 상대 + 로컬 폴백 | `TweetCard.tsx:120,121` | 없음 |
| `draftTimeLabel` | `src/lib/draftUi.ts:19` | instant | 상대 + 로컬 폴백 | `DraftCard.tsx:96` | `draftUi.test.ts:22-26` (**폴백 분기 미커버**) |
| `lastRefreshedLabel` | `src/components/Column.tsx:17` | instant | 순수 상대(폴백 없음) | `Column.tsx:252` | 없음 |
| `shortDate` | `src/components/QuotedCard.tsx:6` | instant | 로컬 | `QuotedCard.tsx:35` | 없음 |
| `fmtDay` | `src/components/PillarPanel.tsx:8` | instant | 로컬 | `PillarPanel.tsx:13,71` | 없음 |
| `fmtDayJst` | `src/components/BriefingSection.tsx:33` | instant | KST +9 (맞음) | `BriefingSection.tsx:554,645` | 없음 |
| `fmtDay` | `src/components/BriefingSection.tsx:27` | **date-only** | 무관 (맞음) | `BriefingSection.tsx:554,643` | 없음 |
| `fmtWeekRange` | `src/components/BriefingSection.tsx:39` | **date-only** | 무관 (맞음) | `BriefingSection.tsx:572` | 없음 |
| `fmtWeek` | `src/components/TrendPanel.tsx:9` | **date-only** | 무관 (맞음) | `TrendPanel.tsx:72,83` | 없음 |
| `ymd` (동명이인) | `src/lib/actualCost.ts:47` | `Date` | **UTC (틀림, 쿼리용)** | `actualCost.ts:58,64,65,79` | 간접 (`actualCost.test.ts:49`) |

### 구조적 문제

1. **`fmtDay`라는 이름이 두 개 있고, 서로 다른 종류의 값을 받는다.** `BriefingSection.tsx:27`은 date-only(C), `PillarPanel.tsx:8`은 instant(A). 이름만 보고 합치면 정확히 이 조사가 경고하는 off-by-one이 생긴다.
2. **`ymd`라는 이름도 두 개다.** `tableColumns.ts:56`(KST, 맞음)과 `actualCost.ts:47`(UTC, 쿼리 파라미터용). 공용화 시 후자를 전자로 갈아끼우면 안 된다 — 후자는 (B)라 KST 날짜로 **바꿔야 하지만** 용도가 표시가 아니라 외부 API 파라미터다.
3. **맞는 구현이 표 전용 파일에 갇혀 있다.** `ymd`/`ymdHm`(KST 고정 +9, 근거 주석 `tableColumns.ts:38-43`이 이미 "Intl에 맡기면 런타임 시간대 데이터에 의존해 테스트가 환경에 흔들린다"까지 정리해 둠)이 `src/lib/tableColumns.ts` — 표 칸 정의 파일 — 에 있다. 반면 틀린 `formatDate`가 범용 이름의 `src/lib/format.ts`에 있다. 새로 들어오는 사람은 `format.ts`를 먼저 집는다.

### 단일 공용 모듈로 대체 가능한가 — 가능하되 **두 계열로 갈라야** 한다

`src/lib/datetime.ts`(가칭) 하나로 모으는 것이 옳지만, 타입 수준에서 두 계열을 분리해야 (C) 사고를 구조적으로 막는다.

- **instant 계열** (입력 = `timestamptz`에서 온 ISO): `kstDate(iso)`(=현 `ymd`), `kstDateTime(iso)`(=현 `ymdHm`), `kstShort(iso)`(=`'26.07.06` 대체), `kstMonthDay(iso)`(=`M/D`), `relativeOrKstDate(iso)`(=`timeAgo`/`draftTimeLabel` 통합), `kstToday()`(=(B) 6건이 쓸 '한국 기준 오늘' `YYYY-MM-DD`).
  - 구현은 `tableColumns.ts`의 `toKstIso`(고정 +9 시프트 후 `getUTC*`)를 그대로 승격하면 된다. 이미 검증·주석·테스트가 있다.
- **date-only 계열** (입력 = `YYYY-MM-DD`): `dateOnlyMonthDay(ymd)`(=`fmtDay`/`fmtWeek`), `weekRangeLabel(weekStart)`(=`fmtWeekRange`), 그리고 기존 `addWeeks`/`weekStartJst`(`trend.ts`)는 그대로 둔다.
  - 이 계열은 **시간대 시프트를 절대 하지 않는다**는 것이 계약이다. 브랜딩 타입(`type DateOnly = string & {__dateOnly:true}`)까지 가면 컴파일러가 A/C 혼동을 잡아준다.

`tableColumns.ts`는 `ymd`/`ymdHm`을 새 모듈에서 re-export만 하게 두면 표 쪽 호출부(4곳 + `TweetCardModal.tsx`)를 건드리지 않고 옮길 수 있다.

---

## 5. 기존 테스트 커버리지

| 헬퍼/규칙 | 테스트 파일 | 내용 | 평가 |
|---|---|---|---|
| `formatDate` | `src/lib/format.test.ts:26-28` | `formatDate('2026-07-06T23:29:44.000Z') === "'26.07.06"` | **KST로 고치면 이 단언이 깨진다.** 23:29Z는 KST 7/7 08:29 → 기대값이 `'26.07.07`로 바뀌어야 한다. 이 테스트가 (A1) 수정의 신호등이다. |
| `ymd`/`ymdHm` | `src/lib/tableColumns.test.ts:44-58` | "UTC로는 7/10인 시각이 한국에서는 7/11" 경계 1건 + `01:02Z → 10:02` 시:분 1건 | 정답 구현의 회귀 방어. 새 공용 모듈로 옮길 때 그대로 가져가면 된다. |
| SQL 경계 `Asia/Seoul` | `src/lib/tableFilter.test.ts:166-170` | `after`/`before`/`fetchedAt` 절의 SQL 문자열을 정규식으로 고정 | (C10)을 지킨다. 손대면 즉시 빨개진다. |
| `isComplete` 날짜 검증 | `src/lib/tableFilter.test.ts:55` | 달력에 없는 날짜 거부 | (C9) 방어. |
| `weekStartJst`/`addWeeks` | `src/lib/trend.test.ts:17-23` | JST 월요일 경계 5건(정각·1초 전·연말 걸침 포함) | (C1)(C2)의 강한 회귀 방어. |
| `briefingPeriod` | `src/lib/briefing.test.ts:31-36` | `from`/`toExclusive`/`toDisplay` 3값 고정 | (C3) 방어. |
| `draftTimeLabel` | `src/lib/draftUi.test.ts:22-26` | `방금`/`5분`/`3시간` 세 분기만 | **(A7) 폴백 분기는 커버되지 않는다.** 고쳐도 테스트가 통과해버려 회귀를 못 잡는다. |
| `timeAgo`, `shortDate`, `PillarPanel.fmtDay`, `lastRefreshedLabel`, `fmtDayJst`, `fmtDay`(브리핑), `fmtWeekRange`, `fmtWeek` | — | **없음** | 컴포넌트 하네스가 없어 이 8개는 테스트가 하나도 없다. 공용 모듈로 끌어올리면 그 순간부터 순수 함수라 테스트가 가능해진다 — 이게 공용화의 가장 큰 실익이다. |
| `usageStore` 일별 집계 | `src/lib/usageStore.test.ts:41-48` | `summarizeByDay` 순수 reshape만 | SQL의 `Asia/Tokyo`(A9)는 실 DB 테스트가 없어 커버되지 않는다. 출력이 안 바뀌므로 위험은 낮다. |

---

## 6. 표시 시간대 vs 쿼리 경계가 어긋날 수 있는 지점

`src/lib/tableFilter.ts:117-118`의 SQL 경계는 이미 `Asia/Seoul`이고 표시(`tableColumns.ymd`)도 KST라 **표 화면은 정합하다** — 여기는 문제가 없다. 문제는 다른 곳이다.

1. **사용량 페이지가 유일한 실제 불일치다.** 막대의 날짜 라벨은 `Asia/Tokyo`(+9) 버킷(`usageStore.ts:66`)인데, 그 데이터를 뽑는 `where created_at >= ${from} and < ${to}` 경계는 UTC 기준으로 만들어진다(`usage/page.tsx:20-24`). 즉 **화면의 첫 막대와 마지막 막대는 항상 부분 집계다** — 라벨은 "7/19 하루"라고 말하지만 실제로는 그날 09:00 KST부터만 담긴다. A9만 고치고 B1을 안 고치면 이 불일치가 그대로 남는다. **A9과 B1은 한 커밋으로 묶어야 한다.**
2. **표 필터 값 ↔ 컬럼 수집 범위 비교** — `src/lib/collectionConflict.ts:96-121`이 사용자가 입력한 필터 날짜(date-only)와 컬럼 설정의 `sinceDate`/`untilDate`(date-only)를 사전식으로 비교해 "이 조건은 수집 범위 밖" 경고를 만든다. 양쪽 다 date-only라 지금은 정합하다. 만약 필터 경계를 "KST 자정"으로 재해석하면서 이 비교를 Date로 바꾸면 경고 문구가 하루 어긋난다. **비교를 문자열로 유지하는 것이 이 정합성의 근거다.**
3. **백필의 `sinceDate`(C) ↔ `untilDate`(B) 혼재** — `BriefingSection.tsx:450`과 `TrendPanel.tsx:40`은 같은 객체 리터럴 안에서 `sinceDate`는 date-only weekStart(C), `untilDate`는 UTC 오늘(B)을 넘긴다. `untilDate`만 KST 오늘로 고치면 정합해진다. 반대로 실수로 `sinceDate`까지 "고치면" 백필 범위가 한 주 밀린다.
4. **표 날짜 필터 ↔ 카드뷰 날짜 표시** — 표(`ymd`, KST)와 카드(`formatDate`, UTC)가 **같은 트윗에 다른 날짜를 보여준다**. 표 팝업(`TweetCardModal.tsx:249`, KST)과 덱 카드(`TweetCard.tsx:252`, UTC)를 나란히 놓으면 09:00 KST 이전 수집분이 하루 차이로 보인다. A1 수정이 이걸 없앤다.

---

## 7. `src/lib/draftUi.ts` — 다른 워크스트림과 충돌 가능

파일 전체가 83줄이고, **날짜 관련은 딱 두 곳**이다.

- `:19-26` `draftTimeLabel(iso)` — `방금`/`N분`/`N시간`(모두 (D)) → 24시간 초과 시 `:24-25`에서 `new Date(iso).getMonth()/getDate()` 로컬 폴백 **(A7)**.
- `:60-65` `newDraftsSince(cur, fetched, sinceMs)` — `Date.parse(d.createdAt) >= sinceMs` 순수 instant 비교 **(D)**. 폴링 병합 로직이라 시간대와 무관.

나머지 7개 export(`hookBoundary`, `draftCopyText`, `collectDraftFlags`, `textsChanged`, `idSetChanged`, `filterDrafts`, `statusCounts`)는 날짜와 전혀 무관하다.

**판단 재료**: 이 파일에서 필요한 변경은 `:24-25` **두 줄**이며, 공용 헬퍼 호출 한 줄(`return relativeOrKstDate(iso)`)로 대체되거나 `getMonth/getDate` → 공용 KST 게터로 바뀔 뿐이다. `draftUi.test.ts`도 폴백 분기를 테스트하지 않아 테스트 충돌도 없다. **제외해도 손실이 작고(사이트 1개), 포함해도 충돌면이 두 줄로 작다.** 다른 워크스트림이 이 파일의 `draftTimeLabel`을 건드리고 있지 않다면 포함하는 쪽을 권한다 — 빼면 `DraftCard.tsx:96`만 앱 전체에서 혼자 로컬 시간대로 남는다.

---

## 8. 변경 규모 — 솔직한 추정

### 숫자

| 항목 | 수 |
|---|---|
| 수정이 필요한 파일 | **14** (+ 신규 공용 모듈 1 + 신규 테스트 1 = **16**) |
| (A) 사이트 | 10 (그중 A9·A10 두 건은 **출력 무변화**, 이름/중복 정리) |
| (B) 사이트 | 6 |
| 실제 손대는 호출 지점 | **약 22** (A 10 + B 6 + 공용 모듈로 옮겨지는 호출부 6) |
| 만지면 안 되는 (C) | 18 |
| 고쳐야 하는 기존 테스트 단언 | 1 (`format.test.ts:28`) |
| 새로 써야 하는 테스트 | 8개 헬퍼분 (현재 커버 0) |

수정 파일 목록: `src/lib/format.ts`, `src/lib/tableColumns.ts`(re-export), `src/lib/usageStore.ts`, `src/lib/actualCost.ts`, `src/lib/draftUi.ts`(조건부), `src/components/TweetCard.tsx`, `src/components/QuotedCard.tsx`, `src/components/PillarPanel.tsx`, `src/components/CandidateCard.tsx`, `src/components/BriefingSection.tsx`, `src/components/TrendPanel.tsx`, `src/components/TweetTableView.tsx`, `src/app/w/[wsId]/usage/page.tsx`, `src/app/api/research/density/route.ts`, `src/app/w/[wsId]/research/page.tsx`.

### 보이는 것보다 위험한 이유

1. **(A)와 (C)가 같은 파일 안에, 심지어 이웃한 줄에 있다.** `src/components/BriefingSection.tsx`가 최악이다 — `:27` `fmtDay`(C, date-only), `:33` `fmtDayJst`(A, instant, 이미 정확), `:39` `fmtWeekRange`(C), `:450` `untilDate`(B). 네 줄 반경 안에 세 가지 분류가 다 있다. `src/lib/trend.ts`도 `:33`(+9 시프트, 맞음)과 `:39`(date-only, 시프트 금지)가 여섯 줄 차이다. **파일 단위 일괄 치환이 불가능하다** — 그렇게 하면 브리핑 주차 라벨과 추이 x축이 통째로 하루/한 주 밀린다.
2. **이름이 같고 의미가 다른 함수가 두 쌍 있다.** `fmtDay`(instant vs date-only), `ymd`(KST 표시용 vs UTC 쿼리용). 공용화 리팩터의 자동 도구(rename/inline)가 정확히 여기서 사고를 낸다.
3. **화면 확인 경로가 없다.** OAuth 도메인 게이팅 때문에 실제 화면은 사용자만 볼 수 있고, 컴포넌트/라우트 테스트 하네스가 존재하지 않는다. `timeAgo`·`shortDate`·`PillarPanel.fmtDay`·`fmtDayJst`·`fmtWeekRange`·`fmtWeek`는 **테스트도 없고 눈으로도 못 본다** — 공용 모듈로 끌어올려 순수 함수로 만들고 테스트를 붙이는 것이 사실상 유일한 검증 수단이다. 이 선행 작업 없이 값만 바꾸면 회귀를 잡을 방법이 없다.
4. **가장 큰 사용자 체감 변화는 (A)가 아니라 (B1)이다.** 사용량 페이지의 `'이번 달'`은 지금 매월 1일 오전 9시간을 빼먹고, 1일 새벽에는 전달을 보여준다. 이건 표시 오차가 아니라 **집계 수치 자체가 다른** 버그다. 그런데 (A) 목록에 섞여 있으면 "표시만 고치는 작업"으로 오해되기 쉽다.
5. **출력이 안 바뀌는 수정 2건(A9·A10)이 리뷰를 흐린다.** `Asia/Tokyo` → `Asia/Seoul`, `fmtDayJst` → 공용 헬퍼는 **diff는 있는데 동작은 동일**하다. 이걸 실제 동작이 바뀌는 커밋과 섞으면 "이 커밋이 무엇을 바꿨는가"를 리뷰어가 판정할 수 없다. 분리 커밋을 권한다.
6. **한 개의 테스트 단언이 의도적으로 깨져야 한다.** `format.test.ts:28`의 기대값 변경은 "실수로 깨진 것"과 구분이 안 된다. 커밋 메시지에 근거(23:29Z = KST 익일 08:29)를 남기지 않으면 다음 사람이 되돌린다.

### 권장 커밋 분할

1. `src/lib/datetime.ts` 신설(instant 계열 + date-only 계열 분리) + 테스트 — **동작 변화 0**.
2. 정답 구현 이관: `tableColumns.ts`의 `ymd`/`ymdHm` → 새 모듈, `tableColumns.ts`는 re-export — **동작 변화 0**.
3. 이름만 고치는 것들: A9(`Asia/Tokyo`→`Asia/Seoul`), A10(`fmtDayJst`→공용) — **동작 변화 0**.
4. (A) 표시 수정 6건(A1~A8 중 실제 변화분) + `format.test.ts:28` 기대값 갱신 — 여기서부터 화면이 바뀐다.
5. (B) 경계 수정 6건. B1+B2는 반드시 같이(§6-1).
