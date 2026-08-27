# 계정 분석 v2: 기간 기준 수집 + 활동/내용 분리 + 전체 분석 — 설계 스펙 (1단계, 리뷰 반영 v2)

- 날짜: 2026-08-27 · 브랜치 `cb-koo/influencer-profile`
- 배경: 100건 상한 수집은 계정마다 창 길이가 0~92일로 제각각(명부 30계정 중 24계정이 상한에 걸림, RT 전문 7계정은 2주 미만·RT 93~99%)이라 히트맵·빈도를 비교할 수 없다. koo 결정: **기간 기준으로 바꾸고, 유형 경계선은 전체를 한 번 돌린 뒤 실제 분포를 보고 정한다(2단계).**
- 1단계 범위: 수집 기준 변경 · 활동/내용 지표 분리 · "퍼나르는 주제" 축 · UI 반영 · 전체 분석(일괄) · 명부에 분석 시점. **유형 라벨·필터·갱신 넛지는 2단계.** 마이그레이션 없음(jsonb).

## 0. 원칙
- **활동**(얼마나·언제)은 **최근 56일(8주) 고정 창**, **내용**(무엇을·어떻게)은 **직접 쓴 글(원글+인용) 최근 60건** — 한 창으로 둘을 채우면 RT 기계는 폭발하고 저빈도 계정은 빈다.
- RT는 활동으로 세되 색·분류의 기준은 직접 쓴 글. RT가 **무엇을** 퍼나르는지는 별도 축(퍼나르는 주제) — 확산 채널의 정체성.
- 숫자마다 판단문. 수집이 **상한에 걸린 경우에만** 캡션(계정 트윗이 소진돼 끝난 건 상한이 아니다 — 라벨-값 일치).
- 시간 예산: 라우트 300초 안에 **저장까지** 끝나야 한다 — 수집 단계 데드라인을 둔다.

## 1. 수집 (`src/lib/tweetSource.ts`)
```ts
export interface FetchOpts {
  activitySince: string;   // 56일 전(8주)
  directTarget: number;    // 60
  lookbackSince: string;   // 6개월 전 — 이보다 오래된 트윗은 push하지 않는다
  maxPages: number;        // 60
  maxTweets: number;       // 2000 — 페이지 크기가 바뀌어도 총량 통제
  deadlineAt?: number;     // epoch ms. 넘기면 그때까지 모은 것으로 반환(truncated=true)
}
export interface FetchResult {
  tweets: AnalysisTweet[];     // 최신순, lookbackSince 이후만, id 중복 제거
  truncated: boolean;          // 페이지/총량/데드라인 상한에 걸려 멈췄나 (계정 트윗 소진은 false)
  reachedActivitySince: boolean; // activitySince까지 거슬러 갔나
  directCount: number;         // 수집된 직접 글(원글+인용) 수
  pagesUsed: number;
}
fetchRecent(userId, opts): Promise<FetchResult>
```
- 페이지 최신순. **정상 종료**: `(가장 오래된 트윗 < activitySince) && (directCount ≥ directTarget || 가장 오래된 트윗 < lookbackSince)` 또는 `!has_more`. **상한 종료(truncated)**: `pagesUsed ≥ maxPages || tweets ≥ maxTweets || now ≥ deadlineAt`.
- 고정글(`isPinned`): **시간순 판정(sawOld)에서만 제외하고 수집에는 포함**, id Set으로 중복 제거 — 4주 창에서 1건의 비중이 커져 버리지 않는다.
- `AnalysisTweet`에 `rtText?: string` — RT면 `raw.retweeted_tweet.text`(없으면 `raw.text`).
- 상수(`influencerAnalysis.ts`): `ACTIVITY_DAYS=56`, `DIRECT_TARGET=60`, `LOOKBACK_MONTHS=6`, `MAX_PAGES=60`, `MAX_TWEETS=2000`, `RT_CLASSIFY_MAX=100`, `COLLECT_DEADLINE_MS=120_000`.

## 2. 활동 통계 (`src/lib/analysisStats.ts`)
```ts
export interface Activity {
  since: string; until: string; days: number;             // 56
  truncated: boolean;            // FetchResult.truncated (캡션은 이때만)
  coveredDays: number;           // reachedActivitySince면 56, 아니면 max(1, 가장 오래된 수집~until 일수); 수집 0건이면 56(8주 내내 0건이 사실)
  directPerDay: number; rtPerDay: number;  // 소수 1자리, 분모 coveredDays
  rtShare: number;               // 창 안 RT / 창 안 전체 (0~1, 소수 2자리; 전체 0이면 0)
  quoteShare: number;            // 창 안 인용 / 창 안 직접 글 (2단계 "인용 위주 확산" 판별용; 직접 0이면 0)
  activeDays: number;            // 직접 글 1건 이상인 날 수
  dailyDirect: Record<string, number>; dailyRt: Record<string, number>;  // KST 날짜별
}
export function computeActivity(tweets: AnalysisTweet[], opts: { since: string; until: string; truncated: boolean; reachedActivitySince: boolean }): Activity;
```
- 기존 `computeStats.perWeek/mix`·`dailyCounts`는 v2에서 미사용(구버전 타입 호환용으로만 남김). 반응 중앙값은 **직접 글 60건 표본** 기준(`computeStats`의 median 로직 재사용 또는 별도 함수).

## 3. 파이프라인 (`src/lib/influencerAnalysis.ts`)
1. 수집(§1, `deadlineAt = now + COLLECT_DEADLINE_MS`) → 2. `activity = computeActivity(창 안 트윗)` → 3. 직접 글 표본 = 직접 글 최신 60건 → 반응 중앙값·청크 분류(기존 스키마)·topics → 4. **RT 분류**: 창 안 RT 최신 `RT_CLASSIFY_MAX`건의 `rtText`를 **경량 스키마(topics만)** 로 분류(별도 시스템 프롬프트·스키마 — contentType/sponsored/evidence 생성 안 함) → 5. **정규화 1콜, 축 라벨링**: 입력 `{direct:[{tag,count}], rt:[{tag,count}]}`, 출력 `{direct:[{tag,absorbs}] 3~5개, rt:[{tag,absorbs}] 3~5개}` — 같은 콜이라 어휘가 자연히 공유되되 **각 축이 자기 슬롯을 갖는다**(합치면 RT 태그가 슬롯을 다 차지해 직접 글 표가 빈다). → `topics`(직접, 조회 중앙값 포함)·`rtTopics`(`{tag,count}`, 조회수 없음) → 6. 종합 1콜: 입력에서 `주당_게시·구성` **제거**, `활동{직접/일·RT/일·RT 비중·인용 비중}`·`퍼나르는_주제` 상위 5 추가. 프롬프트: "RT가 많으면 무엇을 퍼나르는지가 이 계정의 정체성 — headline/tone에 반영".
- **직접 글 0건(RT-only)**: 직접 글 분류·topics는 생략하되 **rtTopics로 종합 1콜을 돌려 headline/tone을 만든다**(`patterns`는 "직접 쓴 글이 없어 반응 패턴은 볼 수 없어요"로 LLM이 쓰게 지시, `sponsorship`은 관찰 없음). RT도 0건이면 기존처럼 `summary=null`.
- 저장 형태(v2):
```ts
sample: { collected: number; direct: number; directClassified: number; rtClassified: number;
          directSince: string | null; until: string; directComplete: boolean; pagesUsed: number; rtSince: string | null }
activity: Activity
stats: { medianViews; medianLikes; typeDist; sponsoredCount }      // 직접 글 표본 기준
topics: TopicStat[]; rtTopics: { tag: string; count: number }[]
summary: { headline; tone; patterns; sponsorship } | null
models
```
- `InfluencerAnalysis` 타입: v1 필드(`sample.count/classified/since/months`, `stats.perWeek/mix`, `daily`) 옵셔널화 + v2 필드 추가. **UI는 `activity` 유무로 분기**하며, v1 경로는 §5의 한 줄 안내만 그리므로 v1 값을 읽는 코드는 제거한다(`judgeCadence`는 v2에서 `judgeDirectCadence`로 대체 — 기존 함수·테스트는 삭제).

## 4. 판단 (`influencerJudgment.ts`)
- `judgeDirectCadence(directPerDay, collectedInWindow)`: 창 안 수집 0건 → `최근 8주 게시 없음 — 활동이 멈춘 계정일 수 있어요`(주의); 주당(=×7) <1 → `주 N건 — 직접 쓰는 글이 드물어요`(주의) / ≤3 `보통` / >3 `활발한 편`. (임계는 2단계에서 분포 보고 조정.)
- `judgeRt(rtPerDay, rtShare)`: 하루 <1 `확산 활동이 거의 없어요` / <10 `확산 활동이 있어요` / ≥10 `확산 활동이 매우 활발해요`, 값 표기 `RT 하루 N건 · 글의 N%`.
- `judgeEngagement` 유지.

## 5. UI (`AnalysisSection.tsx`)
- 캡션: `직접 쓴 글 60건(6/12~8/26) · 활동 최근 8주 · 오늘 분석`. `directComplete=false` → `직접 쓴 글 23건(6개월 안 전부)`. `activity.truncated` → `(수집 상한으로 최근 N일치)`.
- 타일 3: ① 직접 발행 `주 N건`+판단 ② RT `하루 N건 · 글의 N%`+판단 ③ 반응 중앙값+판단.
- **히트맵 2줄**: 위 `직접 쓴 글`(색=`dailyDirect`, 임계 1/2/3~4/5+), 아래 `RT`(색=`dailyRt`, **RT 전용 임계 1~4/5~9/10~19/20+**, 범례 별도 표기) — RT 확산형 계정이 "활동 없음"으로 보이지 않게. 창 = **최근 56일**, 열 = 달력 주(일요일 시작)라 **최대 10열(양끝 부분 열)** — 캡션은 "최근 8주". 셀 20px 고정. 각 격자 `role="img"` aria-label에 기준 명시.
- 유형 도넛(직접 글) + 주제 표(직접 글) 2열 유지. 표 아래 **`퍼나르는 주제`** `ul/li` 칩 `여행 21건 · …`(rtTopics 상위 5) + 캡션 `최근 N일 RT 100건 기준`(rtSince~until). RT 0건이면 생략.
- 서술 3단락 + 헤드라인 유지. RT-only 문구: `직접 쓴 글이 없어 퍼나르는 주제로만 봤어요`(도넛·직접 주제 표 생략).
- **구버전 분석(`activity` 없음)**: 헤드라인·서술은 그대로, 수치·히트맵 자리에 한 줄 `이전 방식으로 분석된 결과예요 — 다시 분석하면 4주 활동·직접 글 기준 지표로 바뀌어요`. v1 값(perWeek·mix·daily)을 읽는 코드는 남기지 않는다.

## 6. 분석 실행 스토어 (`src/app/influencers/analysisRun.ts`) + 전체 분석(일괄)
- `AnalysisSection`의 `startAnalysis`/`inflight`를 **구독 가능한 스토어**로 추출: `start(id)`(진행 중이면 같은 프로미스 재사용) · `getState(id): 'idle'|'running'|'done'|'failed'` · `subscribe(id, cb)`(`useSyncExternalStore`용). 상태 변경 시 구독자 통지 — **이미 열려 있는 프로필**에서도 일괄 실행이 시작한 분석이 "분석 중…"→완료로 반영된다.
- 명부 상단 `전체 분석` → 다이얼로그(기존 `AddInfluencersDialog` 관례: 포커스 트랩·Esc): 대상 = `미분석 + 이전 방식 분석`(옵션 `최근 분석도 포함`), **대상 수 · 예상 비용 `약 $0.1×n(수집+AI, 첫 실행 뒤 실측으로 보정)` · 예상 시간 `n÷3 × 2~3분`**, 그리고 문구 `이 탭을 열어둔 동안 진행돼요. 중간에 닫아도 끝난 계정은 저장돼 있고, 다시 실행하면 남은 계정만 이어서 해요.` `beforeunload` 경고(진행 중일 때).
- 실행: 순수 스케줄러 `runQueue(ids, {concurrency: 3, start})`(테스트 가능)로 동시 3건. 진행 `12/24 완료 · 실패 1`(`aria-live="polite"`), 실패 목록 + `재시도`, 다이얼로그 닫아도 진행(모듈 상태), 명부 헤더 진행 배지. 완료 시 명부 새로고침(`load`).
- 서버 변경 없음(라우트 재사용). 동시 3건 × 60콜의 429는 getxapi 클라이언트의 기존 백오프가 처리 — 수집 데드라인(§1)이 총시간을 막는다.

## 7. 명부 행 (`InfluencerRow`)
- 목록 SELECT에 `i.analyzed_at`과 **`(i.analysis ? 'activity') as analysis_v2`**(jsonb 키 존재 검사 — 값은 싣지 않음) 추가 → `analyzedAt: string | null`, `analysisV2: boolean`. 행 캡션 `분석 N일 전` / `이전 방식` / `미분석`. 일괄 대상 판정도 이 두 값으로.

## 8. 검증
- 단위: fetchRecent(정상 종료 2케이스·상한 3종·소진·고정글 포함+중복 제거·lookback 미포함), computeActivity(경계·0건·미도달 분모), 정규화 두 축 파싱, rtTopics, 판단 2함수, 파이프라인 페이크(일반/RT-only/RT 0), runQueue 동시성, updates 규칙.
- 파급: `influencerAnalysis.test.ts` 페이크 시그니처, `tweetSource.test.ts` 재작성, `analysisStats.test.ts`, `influencerJudgment.test.ts`(judgeCadence 삭제).
- tsc 0 · lint 24 · build · koo QA(3010) · 프로덕션 전체 분석 1회 후 **SQL 직접 조회로 분포표 추출**(analysis jsonb는 상세 전용이므로 psql) → 2단계.
- 사용량 행 폭증(1회 ~2,000행/20~40분) — 첫 실행 때 지연 관찰.

## 9. 2단계(별도)
유형 판정(분포 보고 임계값) · 명부 라벨·필터 · 갱신 넛지(유형별 차등) · 수동 덮어쓰기 여부 · 비용 상수 실측 보정.

## 변경 이력
- 2026-08-27 QA 반영: 활동 창 **4주 → 8주**(koo: 4주는 너무 짧음 — 요일 패턴이 두 배로 반복돼 뚜렷해지고 GitHub 배치가 9~10열로 넓어짐). 히트맵은 **직접/RT 두 줄 → 한 격자 + 토글**(RT 비중 10% 미만이면 토글 숨김), 배치는 GitHub식 유지, 히트맵·유형 도넛·주제 표는 **한 행 3열**(패널 ≥896px). RT 전문 계정은 60페이지 상한 때문에 8주를 못 채우고 "수집 상한으로 최근 N일치" 캡션 — 의도된 동작.
