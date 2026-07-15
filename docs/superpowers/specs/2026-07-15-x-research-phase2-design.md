# X 리서치 Phase 2 — 계정 필러 분석 + 확장 탐색

날짜: 2026-07-15 · 상태: 승인 대기(박구건) · 상위: `2026-07-14-x-research-roadmap.md` · 선행: Phase 1(`2026-07-14-x-research-phase1-design.md`, 머지 완료 14a0663)

## 목표

**축 ② 계정 필러 분석**: 워치리스트(계정) 컬럼의 트윗을 LLM으로 주제별로 묶고, 주제마다 게시량(건수·비중)과 반응(좋아요 중앙값)을 비교해 **"적게 올리는데 반응이 유난히 좋은 주제(저평가 고성과)"를 자동 발굴**한다. 경쟁 계정을 스크롤로 눈치껏 읽던 작업을 표 한 장으로 대체.

**축 ③ 확장 탐색**: 덱의 모든 트윗 카드에서 **답글·스레드·리포스터를 X로 이동 없이 인라인으로 펼쳐본다**. "반응이 좋은데 사람들이 뭐라고 했지?" / "타래인가?" / "누가 증폭했지?"를 그 자리에서 확인.

**성공 기준**: 주간 루틴에서 (a) 계정 컬럼의 주제 분석 표가 기획 글감 후보(⭐ 기회 주제)를 실제로 내놓는가, (b) 벤치마크 트윗의 반응 맥락을 덱 안에서 확인하고 보관함 저장 판단이 빨라지는가.

## 사전 결정 사항 (명료화로 확정)

| 항목 | 결정 |
|---|---|
| 주제 분류 방법 | LLM(Haiku) 분류, 결과 DB 캐시 |
| 주제 체계 | 계정별 자동 도출(5~10개), 고정 분류표·수동 편집 없음 |
| 트윗 유형 | 투고+인용RT 분석(유형 구분 표시), 순수 RT는 현행대로 수집 제외 |
| UI 위치 | 컬럼 내 패널(해시태그 동시출현 패널 패턴), 주제 클릭→트윗 필터링 |
| 데이터 범위 | 컬럼에 쌓인 전부(최근 500건 상한), 표본 부족 시 과거 수집 opt-in 제안 |
| 분석 엔진 | 스냅샷+증분 — 최초 전체 도출·배정 저장, 새 트윗은 증분 분류, 재도출은 명시 버튼 |
| 확장 UX | 카드 아래 인라인 펼침, opt-in 클릭당 1콜, 결과 DB 저장 안 함 |
| 인게이지먼트 축 | '좋아요' 기준(중앙값), 로드맵 전제 준수 |

## 아키텍처 위치 (경계)

Phase 1과 동일 — **X 리서치 본체는 덱**이며 이번 변경도 전부 덱과 하위 컴포넌트에서 일어난다. `리서치` 페이지(exa 웹 트랙)는 건드리지 않는다. 필러 분석은 **워치리스트 컬럼 전용**(분석 단위 = 컬럼 1개 = 계정 1개), 확장 탐색은 **컬럼 종류 무관 모든 트윗 카드**에 붙는다. 인용 역탐색(quotes)은 엔드포인트 부재(404)로 영구 제외.

## 범위

**포함**: ①필러 분석(주제 도출·배정·통계·판정·패널 UI) ②표본 부족 시 과거 백필 ③확장 탐색(답글/스레드/리포스터 인라인) ④getxapi 클라이언트 메서드 3종.
**제외**: 계정 간 주제 비교, 주제명 수동 편집/병합(필요 확인 시 v2), 새로고침 시 자동 분류(AGENTS.md 원칙 6 — 실사용 마찰 확인 후 승격 검토), 확장 결과 DB 저장, 트렌드·기간 종합(Phase 3), 인용 역탐색(영구 제외).

## 컴포넌트 설계

### 1. DB — `migrations/006_pillar.sql` (멱등)

```sql
create table if not exists pillar_analysis (
  column_id uuid primary key references deck_column(id) on delete cascade,
  topics jsonb not null,              -- [{id: string, label: string}]
  sample_size int not null,
  model text,
  analyzed_at timestamptz not null default now()
);

create table if not exists tweet_topic (
  column_id uuid not null references deck_column(id) on delete cascade,
  tweet_id text not null references tweet(tweet_id) on delete cascade,
  topic_id text not null,             -- pillar_analysis.topics[].id 참조(soft)
  primary key (column_id, tweet_id)
);
```

- 컬럼당 스냅샷 1개(PK=column_id). "주제 다시 도출" 시 스냅샷+배정을 **트랜잭션으로 통째 교체**.
- `tweet_topic`에 행이 없는 트윗 = **미분류**(LLM이 배정 실패했거나 분석 후 새로 수집된 트윗). 별도 'unclassified' id를 예약하지 않는다.
- 좋아요 등 지표는 저장하지 않고 조회 시 `tweet` 테이블에서 계산 — 통계가 항상 최신 지표 반영.

### 2. LLM 엔진 — `src/lib/pillar.ts`

`suggest.ts` 패턴 그대로: `AnthropicLike` 주입 가능, 모델 `process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001'`, JSON 프롬프트 + `extractJson` 재사용.

- `deriveTopics(client, tweets: {id, text}[]): {topics: {id, label}[], assignments: {tweetId, topicId}[]}`
  - 트윗 전체(최신순 상한 500건)를 한 호출로 보내 주제 5~10개 도출 + 트윗별 배정을 함께 받는다.
  - 프롬프트 요건: 주제 라벨은 한국어(담당자 언어), 5~10개, 계정의 콘텐츠 기둥 관점(홍보 형식이 아니라 소재·화두 기준), 배정 불확실한 트윗은 생략 가능(→미분류).
- `classifyTweets(client, topics, tweets): {tweetId, topicId}[]` — 기존 주제 목록에 새 트윗만 배정(주제 이름 안정 유지, 증분 비용 최소). 어느 주제에도 안 맞으면 생략.
- 응답 검증: 존재하지 않는 topicId·tweetId 배정은 버린다(방어).

### 3. 통계·판정 — `src/lib/pillarStats.ts` (순수 함수)

`computePillarStats(tweets, assignments, topics)` → 주제별 행:
`{topicId, label, count, sharePct, postCount, quoteCount, medianLikes, verdict, judgment}`

- 입력 트윗: 해당 컬럼의 분석 대상 전체(미분류 포함 — 미분류는 '미분류' 행으로 집계만).
- `medianLikes` = 그 주제 트윗 좋아요 **중앙값**(단발 대박 왜곡 방지). 계정 전체 중앙값 `accountMedian`도 계산.
- **판정 규칙(파생값으로 통일 — 라벨↔값 모순 금지, AGENTS.md 원칙 4)**:
  - `opportunity`(⭐ 기회 주제): 비중 < 균등비중(100/주제수 %) **AND** `medianLikes ≥ 1.5 × accountMedian` **AND** 건수 ≥ 3
  - `core`(주력): 비중 ≥ 균등비중 **AND** `medianLikes ≥ accountMedian`
  - `low`(반응 낮음): `medianLikes < 0.5 × accountMedian`
  - 그 외 `normal`(반응 보통)
- `judgment` = 판정을 사용자 언어 한 줄로(원칙 3): 예) ⭐"적게 올리는데 반응 최상 — 기회 주제", core "이 계정의 주력 주제", low "많이 올리지만 반응 낮음"(비중 높을 때).
- 정렬: opportunity 먼저, 이후 medianLikes 내림차순. '미분류' 행은 항상 맨 아래.

### 4. API

- `POST /api/columns/[id]/pillar` — body `{mode: 'full' | 'incremental'}`
  - `full`: 컬럼 트윗(최신 500건, **버림(dismissed) 제외** — 담당자가 치운 트윗은 분석에도 미포함) 로드 → `deriveTopics` → 스냅샷+배정 트랜잭션 교체.
  - `incremental`: 미배정 트윗만 로드 → `classifyTweets` → `tweet_topic` insert(`on conflict do nothing`).
  - 저장은 `src/lib/pillarStore.ts`(`saveAnalysis`, `addAssignments`, `getAnalysis`, `listUnassigned`).
- `GET /api/columns/[id]/pillar` — `{analysis, stats, tweetTopics: {tweetId→topicId}, unassignedCount, samplePeriod: [from, to]}`. 분석 없으면 404 아닌 `{analysis: null}`.
- 과거 백필: 기존 `POST /api/columns/[id]/refresh`에 body `{maxPages?: number}` (상한 10) 추가 — `refreshColumn`은 이미 `maxPages`를 받으므로 라우트에서 전달만. 더 깊이 페이지네이션하면 더 오래된 트윗까지 수집된다.

### 5. 패널 UI — `src/components/PillarPanel.tsx`

- 워치리스트 컬럼 헤더에 **`주제 분석`** 버튼(내부 개념어 '필러'는 코드에만 — 원칙 1). 버튼 옆 한 줄 도움말(원칙 2): "이 계정의 트윗을 주제별로 묶어 반응을 비교해요 · 약 $0.05 이하".
- 패널 구성(승인된 와이어프레임):
  - 헤더: `주제 분석 · 표본 N건 (5/1~7/15) · 투고 n건 · 인용RT n건 · 분석일`
  - 주제 행: `⭐?` 라벨 · `n건(비중%)` · `♥중앙값` · 판정 한 줄. ⭐ 행 상단 고정.
  - **주제 클릭 → 아래 트윗 목록이 그 주제만 필터링**(GET의 `tweetTopics` 맵으로 클라이언트 필터, 재클릭/✕로 해제). 필터 중임을 컬럼에 표시.
  - 상황 버튼: 표본 < 50건 → "표본이 적어요 — 과거 트윗 더 가져오기(약 $0.01)"(refresh maxPages=10 호출 후 재분석 유도) / 미배정 새 트윗 있음 → "새 트윗 N건 분류" / 항상 → "주제 다시 도출"(전체 재분석 경고 카피 포함).
- 트윗 카드에 현재 주제 라벨 배지는 붙이지 않는다(카드 과밀 방지, 필터링으로 충분 — v1).

### 6. getxapi 확장 — `src/lib/getxapi.ts`

메서드 3종 추가(기존 `get<T>()` 재사용 — 재시도·백오프·인증 에러 동일):

- `getTweetReplies(tweetId, cursor?)` → `/twitter/tweet/replies?tweetId=`
- `getTweetThread(tweetId, cursor?)` → `/twitter/tweet/thread?tweetId=`
- `getTweetRetweeters(tweetId, cursor?)` → `/twitter/tweet/retweeters?tweetId=`

(경로·응답 형태는 방법론 조사 시 실측 완료. 구현 시 스모크 스크립트로 계약 재확인.)

프록시 라우트: `GET /api/tweets/[id]/replies|thread|retweeters?cursor=` — 키 서버 보관, 응답을 화면용 최소 형태로 매핑(`mappers.ts`에 답글·리포스터 매퍼 추가).

### 7. 확장 탐색 UI — `src/components/TweetExpansion.tsx`

- `TweetCard` 하단 액션 줄에 `[답글] [스레드] [리포스터]` 소형 버튼(클릭 전 호출 없음 — opt-in, 원칙 6. 호버 툴팁: "X에서 불러와요 · 1회 $0.001").
- 클릭 → 카드 바로 아래 인라인 섹션 펼침(승인된 와이어프레임). 같은 카드에서 탭 전환 가능, ✕로 접기.
  - 답글: 작성자·본문·좋아요 간결 표시.
  - 스레드: 연결 트윗을 순서대로(같은 계정의 타래 확인용).
  - 리포스터: 계정 목록(핸들·이름·팔로워 수) — 시딩/증폭 계정 관찰용.
  - `[더 보기]` = 다음 cursor 호출.
- 결과는 컴포넌트 상태로만 유지(DB 저장 없음). 카드 언마운트 시 소멸.

## 데이터 흐름

**필러 분석**: 계정 컬럼 새로고침(기존, 트윗 누적) → [주제 분석] 클릭 → POST pillar(full) → 스냅샷+배정 저장 → GET pillar → 패널 표시 → 주제 클릭으로 트윗 필터 → 좋은 트윗은 기존 보관함 저장. 다음 주: 새로고침 → 패널의 "새 트윗 N건 분류" → 갱신된 표 확인.

**확장 탐색**: 카드의 [답글/스레드/리포스터] 클릭 → GET 프록시 → 인라인 표시(저장 없음).

## 에러 처리

- 필러 분석 LLM 실패(파싱·타임아웃): "분석 실패 — 다시 시도" 표시, **기존 스냅샷은 건드리지 않음**(교체는 성공 시에만 트랜잭션 커밋).
- 트윗 0건 컬럼에서 분석 요청: "분석할 트윗이 없어요 — 먼저 새로고침하세요".
- 증분 분류 대상 0건: 버튼 비노출(상태 기반).
- 확장 조회 실패(getxapi 에러·404): 펼침 영역에 "불러오기 실패 — 다시 시도" 인라인, 카드 본체는 무영향.
- 백필 refresh 실패: 기존 refresh 에러 처리 그대로.

## 테스트

- `pillarStats.test.ts`(순수): 판정 4종 경계값(비중·1.5배·3건 규칙), 중앙값(짝수/홀수/단건), 미분류 행, 빈 입력.
- `pillar.test.ts`(가짜 LLM): deriveTopics/classifyTweets 응답 파싱, 잘못된 topicId·tweetId 방어, 500건 상한.
- `pillarStore.test.ts`(실DB): 스냅샷 교체 트랜잭션(교체 후 이전 배정 잔존 없음), 증분 insert 멱등, 미배정 목록.
- `getxapi.test.ts` 추가: 신규 메서드 3종 픽스처 파싱 + `scripts/smoke-*` 실계약 확인.
- 브라우저 육안: 주제 분석 버튼→패널→주제 클릭 필터→해제, 표본 부족 버튼, 카드 확장 3종·더 보기·접기.
- 기존 테스트 전체 green 유지.

## 파일 요약

- 수정: `getxapi.ts`, `mappers.ts`, `TweetCard.tsx`, `Column.tsx`(패널·필터 배선), `app/api/columns/[id]/refresh/route.ts`(maxPages)
- 신규: `migrations/006_pillar.sql`, `lib/pillar.ts`, `lib/pillarStats.ts`, `lib/pillarStore.ts`, `components/PillarPanel.tsx`, `components/TweetExpansion.tsx`, `app/api/columns/[id]/pillar/route.ts`, `app/api/tweets/[id]/replies|thread|retweeters/route.ts` (+ 각 테스트)
