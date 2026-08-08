# 날짜·시각 표기를 서울 기준으로 통일 (설계)

2026-08-08.

**배경.** 2026-07-31에 표 보기의 시간대를 고치면서(표시 KST + SQL 경계 `Asia/Seoul`) 앱의 나머지가 그대로라는 걸 알았고, 08-01에 카드 팝업 작업 중 다시 드러났다 — 표의 `최종 수집 시간`과 카드의 `갱신`이 같은 값인데 하나는 KST, 하나는 UTC였다. 그때는 팝업 쪽만 맞추고 백로그로 남겼다(`2026-08-01-table-card-modal-layout-and-instant-render-design.md` §G).

**근거 자료.** 착수 전 `main` 전수 조사를 했다: `docs/superpowers/specs/2026-08-08-seoul-timezone-survey.md`. 모든 날짜·시각 사용처를 **(A) 표시가 UTC/로컬 · (B) '오늘'을 UTC로 계산 · (C) 날짜 전용 값의 올바른 왕복(건드리면 안 됨) · (D) 무관** 으로 분류했다. 이 설계는 그 조사를 전제로 하며, 개별 근거는 조사 문서를 본다.

## 이 작업이 실제로 무엇인가

**표기 통일 작업이 아니라 버그 수정이 섞인 작업이다.** 조사에서 나온 가장 큰 것은 표시 오차가 아니라 집계 오류다.

- `/usage`의 `'이번 달'`이 서버 로컬(UTC)로 경계를 만든다. ①매월 1일 오전 9시간이 빠지고 ②한국 시간 1일 00:00~09:00에 열면 **전달**을 보여준다.
- 같은 화면에서 막대 라벨은 `Asia/Tokyo`(+9) 버킷인데 데이터 경계는 UTC다 → **첫·마지막 막대가 항상 부분 집계**인데 라벨은 하루라고 말한다.

나머지 (B) 5건도 '오늘'이 하루 밀리는 동작 버그다(CSV 파일명, 브리핑·추이 백필의 `until:`, 리서치 밀도의 `since:`).

## 원칙

- **파일 단위로 훑지 않는다.** (A)와 (C)가 같은 파일 이웃한 줄에 있다 — `BriefingSection.tsx`는 네 줄 반경에 (C)·(A)·(C)·(B)가 다 있고 `trend.ts`는 여섯 줄 차이다. 반드시 **사이트 단위**로 조사 문서의 번호(A1…A10, B1…B6)를 짚어 고친다.
- **(C)는 손대지 않는다.** 조사 문서 §2의 18건. 각 항목에 "고치면 깨지는 것"이 적혀 있다. 특히 `trend.ts:33`의 `weekStartJst`는 **이미 +9**라 시프트를 더하면 모든 주 버킷이 한 주 밀린다.
- **이름이 같고 의미가 다른 함수를 자동 도구로 합치지 않는다.** `fmtDay`가 두 개(instant / date-only), `ymd`가 두 개(KST 표시 / UTC 쿼리 파라미터)다. rename·inline 리팩터가 정확히 여기서 사고를 낸다.
- **동작이 안 바뀌는 변경은 따로 커밋한다.** A9·A10은 diff는 있는데 출력은 동일하다. 동작이 바뀌는 커밋과 섞으면 리뷰가 성립하지 않는다.
- **고정 +9를 쓴다. `Intl`에 맡기지 않는다.** 한국은 1988년 이후 DST가 없고, `Intl`은 런타임 시간대 데이터에 의존해 테스트가 환경에 흔들린다(`tableColumns.ts:38-43`이 이미 이 판단을 기록해 뒀다 — 그 구현을 승격한다).

---

## A. 공용 모듈 — 두 계열로 나눈다

`src/lib/datetime.ts` 신설. **타입 수준에서 두 계열을 갈라** (C) 사고를 구조적으로 막는 것이 이 모듈의 핵심 책임이다.

**instant 계열** — 입력은 `timestamptz`에서 온 ISO(시각 성분이 있다). 전부 고정 +9 시프트 후 UTC 게터.

| 함수 | 대체 대상 |
|---|---|
| `kstDate(iso)` → `YYYY-MM-DD` | 현 `tableColumns.ymd` |
| `kstDateTime(iso)` → `YYYY-MM-DD HH:MM` | 현 `tableColumns.ymdHm` |
| `kstShort(iso)` → `'26.07.06` | 현 `format.formatDate` (A1) |
| `kstMonthDay(iso)` → `M/D` | `PillarPanel.fmtDay`(A6), `BriefingSection.fmtDayJst`(A10) |
| `kstMonthDayKo(iso)` → `M월 D일` | `TweetCard.timeAgo` 폴백(A4), `QuotedCard.shortDate`(A5) |
| `kstToday()` → `YYYY-MM-DD` | (B) 6건이 쓸 '한국 기준 오늘' |
| `kstMonthStart()` / `kstDaysAgo(n)` → `Date` | B1의 기간 경계 |

**date-only 계열** — 입력은 `YYYY-MM-DD`. **이 계열은 시간대 시프트를 절대 하지 않는다**는 것이 계약이다.

| 함수 | 대체 대상 |
|---|---|
| `dateOnlyMonthDay(d)` → `M/D` | `BriefingSection.fmtDay`(C6), `TrendPanel.fmtWeek`(C8) |
| `weekRangeLabel(weekStart)` → `6/15~21` | `BriefingSection.fmtWeekRange`(C7) |

`trend.ts`의 `weekStartJst`·`addWeeks`는 **옮기지 않는다** — 이미 정확하고 강한 회귀 테스트(`trend.test.ts:17-23`)가 붙어 있다.

**타입으로 못 섞게 한다.** `export type DateOnly = string & { readonly __dateOnly: unique symbol }`를 두고 date-only 계열은 이 타입만 받는다. `asDateOnly(s)` 변환 함수를 좁은 입구로 둔다. 이것이 이 작업에서 (C) 사고를 막는 유일한 기계적 장치다 — 나머지는 사람의 주의력에 의존한다.

**`tableColumns.ts`는 `ymd`/`ymdHm`을 새 모듈에서 re-export만 한다.** 표 쪽 호출부 5곳(`tableColumns` 내부 4 + `TweetCardModal`)을 건드리지 않고 옮기기 위해서다.

## B. 검증 — 이 작업의 진짜 이득

**8개 헬퍼가 테스트도 없고 화면으로도 못 본다**(OAuth 게이팅 + 컴포넌트 하네스 없음): `timeAgo` `shortDate` `PillarPanel.fmtDay` `lastRefreshedLabel` `fmtDayJst` `fmtDay`(브리핑) `fmtWeekRange` `fmtWeek`.

컴포넌트 안에 박힌 이 함수들을 공용 모듈로 끌어올리면 **그 순간 순수 함수가 되어 테스트가 가능해진다.** 값만 바꾸고 끝내면 회귀를 잡을 방법이 없다. 그래서 모듈 신설이 선택이 아니라 전제다.

새 테스트는 **경계값 중심**으로 쓴다: UTC 15:00(=KST 익일 00:00) 전후, 자정 정각, 월말·연말 걸침. `tableColumns.test.ts:44-58`의 기존 경계 테스트를 새 모듈로 가져간다.

**의도적으로 깨지는 테스트가 하나 있다.** `format.test.ts:28`이 `formatDate('2026-07-06T23:29:44.000Z') === "'26.07.06"`을 고정하고 있다. 23:29Z는 KST 7/7 08:29이므로 기대값이 `'26.07.07`로 바뀐다. **커밋 메시지에 이 계산을 남긴다** — 안 남기면 다음 사람이 "깨진 테스트"로 보고 되돌린다.

## C. 범위에서 빼는 것

- **`src/lib/draftUi.ts` (A7)** — `cb-koo/content-generator`가 이 파일을 수정 중이다(그쪽 계획의 파일 목록에 있음). 고칠 건 `:24-25` 두 줄뿐이라 빼도 손실이 사이트 1개이고, 지금 만지면 병합 충돌이 난다. **그쪽이 `main`에 병합된 뒤 한 줄짜리 후속으로 처리한다.** 그때까지 `DraftCard.tsx:96`이 앱에서 유일하게 브라우저 로컬 시간대로 남는다 — 한국에서는 맞게 보이므로 사용자 영향은 없다.
- **`actualCost.ts`의 `periodStart`/`periodEnd`** — 화면에 렌더되지 않는다(`ActualCostPanel.tsx`가 안 쓴다). 캐시 키도 (D)다. `ymd(from)`/`ymd(to)`가 쓰이는 **Exa API 쿼리 파라미터만** 고친다.
- **(C) 18건 전부** — 조사 문서 §2.

## D. 작업 순서와 커밋 분할

조사 문서 §8의 권장 분할을 따른다. 앞의 둘은 **동작 변화 0**이라 안전하게 먼저 깔 수 있다.

1. **`datetime.ts` 신설 + 테스트** — 동작 변화 0
2. **정답 구현 이관** — `tableColumns.ts`의 `ymd`/`ymdHm` → 새 모듈, `tableColumns.ts`는 re-export — 동작 변화 0
3. **사용량** — A9(`Asia/Tokyo`→`Asia/Seoul`, 출력 무변화) + **B1**(기간 경계 KST) + B2(Exa 쿼리 파라미터). §6-1에 따라 **A9과 B1은 반드시 한 커밋**
4. **카드·표시** — A1(`formatDate`→KST) + `format.test.ts:28` 기대값 갱신 + A2·A3·A4·A5·A6·A8
5. **브리핑·추이·표 경계** — A10(이름 정리, 출력 무변화) + B3·B4·B5·B6

**3·4·5는 파일이 겹치지 않아 병렬로 할 수 있다.** 3=`usageStore.ts`·`usage/page.tsx`·`actualCost.ts` / 4=`format.ts`·`format.test.ts`·`TweetCard`·`QuotedCard`·`PillarPanel`·`CandidateCard`·`research/page` / 5=`BriefingSection`·`TrendPanel`·`TweetTableView`·`api/research/density`.

## E. 검증 기준

`main` 기준선을 착수 직전에 측정했다: **테스트 376건 전부 통과(약 5분) · 린트 25개(에러 14·경고 11) · `npx tsc --noEmit` 무출력**. 작업 후 테스트는 늘어야 하고(새 헬퍼 테스트), 린트는 25 그대로여야 한다.

화면 확인은 OAuth 게이팅 때문에 사용자만 가능하다. 다만 이번엔 **바뀌는 값 대부분이 순수 함수 테스트로 덮인다** — 눈으로만 확인할 수 있는 건 `/usage`의 기간 경계와 각 화면의 날짜가 실제로 하루 당겨졌는지 정도다.

## F. 하지 않는 것

- **`Intl`/`toLocaleDateString` 도입** — 런타임 시간대 데이터 의존. 고정 +9를 쓴다.
- **`trend.ts`·`briefing.ts`의 주 계산 이관** — 이미 정확하고 회귀 테스트가 강하다. 건드릴 이유가 없다.
- **SQL 경계 재작업** — `tableFilter.ts`는 이미 `Asia/Seoul`이고 표시와 정합하다(조사 §6).
- **서버 시간대 설정 변경** — Postgres TZ를 바꾸면 (C)로 분류된 모든 왕복이 동시에 흔들린다. 애플리케이션 층에서만 고친다.
