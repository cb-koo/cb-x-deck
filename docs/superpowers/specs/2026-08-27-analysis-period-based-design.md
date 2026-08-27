# 계정 분석 v2: 기간 기준 수집 + 활동/내용 분리 + 전체 분석 — 설계 스펙 (1단계)

- 날짜: 2026-08-27 · 브랜치 `cb-koo/influencer-profile`
- 배경: 100건 상한 수집은 계정마다 창 길이가 0~92일로 제각각(명부 30계정 중 24계정이 상한에 걸림, RT 전문 7계정은 2주 미만)이라 히트맵·빈도를 비교할 수 없다. koo 결정: **기간 기준으로 바꾸고, 유형 경계선은 전체를 한 번 돌린 뒤 실제 분포를 보고 정한다(2단계).**
- 1단계 범위: 수집 기준 변경 · 활동/내용 지표 분리 · "퍼나르는 주제" 축 · UI 반영 · 전체 분석(일괄) · 명부에 분석 시점. **유형 라벨·필터·갱신 넛지는 2단계.** 마이그레이션 없음(jsonb).

## 0. 원칙
- **활동**(얼마나·언제 올리나)은 **최근 4주 고정 창**으로, **내용**(무엇을·어떻게 쓰나)은 **직접 쓴 글(원글+인용) 최근 60건**으로 — 한 창으로 둘을 채우면 RT 기계는 폭발하고 저빈도 계정은 빈다.
- RT는 활동으로 세되 색·분류의 기준은 직접 쓴 글. RT가 **무엇을** 퍼나르는지는 별도 축(퍼나르는 주제)으로 본다 — 확산 채널의 정체성.
- 숫자마다 판단문, 수집이 상한에 걸리면 그 사실을 캡션에(라벨-값 일치).

## 1. 수집 (`src/lib/tweetSource.ts`)
```ts
export interface FetchOpts { activitySince: string; directTarget: number; lookbackSince: string; maxPages: number }
export interface FetchResult {
  tweets: AnalysisTweet[];       // 수집한 전부(최신순), isPinned 제외
  activityComplete: boolean;     // activitySince까지 거슬러 갔나(상한에 안 걸렸나)
  directComplete: boolean;       // 직접 글 directTarget건을 확보했나(lookbackSince 안에서)
  pagesUsed: number;
}
fetchRecent(userId, opts): Promise<FetchResult>
```
- 페이지는 최신순. 각 트윗 처리 후 **중단 조건**: `(가장 오래된 트윗 < activitySince) && (직접 글 ≥ directTarget || 가장 오래된 트윗 < lookbackSince)` 또는 `pagesUsed ≥ maxPages`.
- 상수(`influencerAnalysis.ts`): `ACTIVITY_DAYS = 28`, `DIRECT_TARGET = 60`, `LOOKBACK_MONTHS = 6`, `MAX_PAGES = 60`(≈1,200건·$0.06·수집 30~60초 — Vercel 300초 안).
- `AnalysisTweet`에 `rtText?: string` 추가: RT면 `raw.retweeted_tweet.text`(없으면 `raw.text`) — 퍼나르는 주제 분류용. 매퍼 헬퍼는 기존 그대로.

## 2. 활동 통계 (`src/lib/analysisStats.ts`)
```ts
export interface Activity {
  since: string; until: string; days: 28;
  complete: boolean;                 // FetchResult.activityComplete
  coveredDays: number;               // complete면 28, 아니면 가장 오래된 수집~until 일수
  directPerDay: number; rtPerDay: number;   // 소수 1자리, 분모 = coveredDays
  rtShare: number;                   // 창 안 RT / 창 안 전체 (0~1, 소수 2자리)
  activeDays: number;                // 직접 글이 1건 이상인 날 수
  dailyDirect: Record<string, number>;  // KST 날짜별 직접 글(원글+인용)
  dailyRt: Record<string, number>;      // KST 날짜별 RT
}
export function computeActivity(tweets: AnalysisTweet[], opts: { since: string; until: string; complete: boolean }): Activity;
```
- 기존 `computeStats`의 `perWeek`·`mix`는 v2에서 쓰지 않는다(삭제 대신 미사용 — 구버전 데이터 타입 호환). 반응 중앙값(`medianViews/Likes`)은 **직접 글 60건 표본** 기준으로 계속 계산.
- `dailyCounts`는 `dailyDirect/dailyRt`로 분리(kind 필터 인자).

## 3. 파이프라인 (`src/lib/influencerAnalysis.ts`)
1. 수집(§1) → 2. `activity = computeActivity(창 안 트윗)` → 3. 직접 글 표본 = 직접 글 중 최신 60건 → 반응 중앙값·청크 분류(기존)·태그 정규화·topics → 4. **RT 분류**: 창 안 RT 중 최신 100건의 `rtText`를 같은 분류기로(topics만 사용, sponsored/type은 저장 안 함) → 정규화(직접 글 태그와 **같은 정규화 콜에 합쳐** 대표 태그 어휘를 공유) → `rtTopics: {tag, count}[]`(조회수 없음 — RT 지표는 원작자 것) → 5. 종합 1콜: 기존 입력 + `활동(직접/일·RT/일·RT 비중)` + `퍼나르는_주제` 상위 5. 프롬프트에 "RT가 많으면 무엇을 퍼나르는지가 이 계정의 정체성 — headline/tone에 반영" 추가.
- 직접 글 0건·RT만: 기존 RT-only 처리 유지 + rtTopics는 계산(이 계정의 유일한 내용 정보).
- 저장 형태(v2, 전부 새 필드 — 구버전 분석은 `activity` 부재로 구분):
```ts
sample: { collected: number; direct: number; directClassified: number; rtClassified: number;
          directSince: string | null; until: string; directComplete: boolean; pagesUsed: number }
activity: Activity
stats: { medianViews; medianLikes; typeDist; sponsoredCount }      // 직접 글 표본 기준
topics: TopicStat[]; rtTopics: { tag: string; count: number }[]
summary: { headline; tone; patterns; sponsorship } | null
models
```
- `InfluencerAnalysis` 타입은 v1 필드(`sample.count/classified/since/months`, `stats.perWeek/mix`, `daily`)를 옵셔널로 남기고 v2 필드를 추가 — UI는 `activity` 유무로 분기.

## 4. 판단 (`influencerJudgment.ts`)
- `judgeDirectCadence(directPerDay)` → 주당 환산 문구: `주 N건 — 직접 쓰는 글이 드물어요 / 보통 / 활발한 편`(임계 1·3건/주 유지 — **2단계에서 분포 보고 조정**).
- `judgeRt(rtPerDay, rtShare)` → `RT 하루 N건 · 글의 N% — 확산 활동이 거의 없음 / 있음 / 매우 활발`(임계 1·10건/일 초안).
- `judgeEngagement` 유지.

## 5. UI (`AnalysisSection.tsx`)
- 캡션: `직접 쓴 글 60건(6/12~8/26) · 활동 최근 4주 · 오늘 분석`. `directComplete=false`면 `직접 쓴 글 23건(6개월 안에서 전부)`, `activity.complete=false`면 활동 캡션에 `(수집 상한으로 최근 N일치)`.
- 타일 3개: ① **직접 발행** `주 N건` + 판단 ② **RT** `하루 N건` + 판단(+RT 비중) ③ 반응 중앙값 + 판단(기존).
- 히트맵: **4주 고정(4열)**, 색 = `dailyDirect`, 소제목 `발행 활동 — 직접 쓴 글, 최근 4주`, 격자 아래 한 줄 `RT는 하루 평균 N건(색에는 안 넣었어요)`. 셀 20px 고정 유지.
- 유형 도넛(직접 글) + 주제 표(직접 글) 2열 유지. 표 아래 **`퍼나르는 주제`**: 칩 목록 `여행 21건 · 미용 9건 …`(rtTopics 상위 5, RT가 0이면 생략).
- 서술 3단락 + 헤드라인 유지.
- 구버전 분석(`activity` 없음): 헤드라인·서술은 그대로 보이고, 수치·히트맵 자리에 한 줄 `이전 방식으로 분석된 결과예요 — 다시 분석하면 4주 활동·직접 글 기준 지표로 바뀌어요`.

## 6. 전체 분석(일괄) — 명부 상단
- 버튼 `전체 분석` → 다이얼로그: 대상 = `미분석 + 이전 방식 분석` (옵션: `최근 분석도 포함`), **대상 수 · 예상 비용($0.06×n) · 예상 시간(n÷3 분)** 표시 후 `시작`.
- 실행: 클라이언트가 **동시 3건**으로 `/api/influencers/[id]/analyze` 호출. 분석 시작 함수는 `AnalysisSection`의 `startAnalysis`+`inflight` 레지스트리를 `src/app/influencers/analysisRun.ts`로 추출해 공유 — 프로필을 열어도 "분석 중…"이 이어지고 중복 실행이 없다.
- 진행: 다이얼로그에 `12/24 완료 · 실패 1`, 닫아도 계속(모듈 상태), 명부 헤더에 작은 진행 배지. 실패 계정은 목록 + `재시도`. 완료 시 명부 새로고침.
- 서버 변경 없음(라우트 재사용). 사용량은 기존 usage 기록으로 자동 집계.

## 7. 명부 행에 분석 시점
- `InfluencerRow`에 `analyzedAt: string | null` 추가(목록 SELECT에 `i.analyzed_at` — 타임스탬프 1개, jsonb는 싣지 않음). 행에 `분석 N일 전` / `미분석` 캡션. 일괄 분석 대상 판정도 이 값으로. (유형 라벨·넛지는 2단계.)

## 8. 검증
- 단위: fetchRecent 중단 조건(4주 미달·직접 60 달성·lookback·페이지 상한 4케이스), computeActivity(경계·complete=false 분모), rtTopics 집계, 판단 문구, 파이프라인 페이크(직접 글 있음/RT-only/구버전 없음), 일괄 실행 동시성(순수 스케줄러 함수 분리해 테스트).
- tsc 0 · lint 24 · build · koo 화면 QA(3010) · 프로덕션에서 전체 분석 1회 → 2단계 분포표.

## 9. 2단계(별도)
유형 판정(RT 확산형/저빈도/일반 — 분포 보고 임계값) · 명부 라벨·필터 · 갱신 넛지(유형별 차등) · 유형 수동 덮어쓰기 여부.
