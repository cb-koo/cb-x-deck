# cb-x-deck API 사용량·비용 페이지 — 설계

작성일: 2026-07-20
상태: 설계 승인 대기

## 1. 목적 / 배경

cb-x-deck가 쓰는 외부 유료 API의 **사용량과 추정 비용**을 콘텐츠 기획 담당자가 한눈에 볼 수 있는 `/usage` 페이지를 만든다. 현재 앱은 API 호출을 전혀 기록하지 않으므로, 호출 계측 → 저장 → 집계·환산·표시까지 새로 만든다.

대상 API 세 개:
- **getxapi** — X/트위터 데이터(검색·유저 트윗·트윗 상세·리플·스레드·리트위터·유저 정보)
- **Exa** — 웹 기사 검색(`/search`)
- **Anthropic** — LLM(키워드 추천·번역·태그 번역·브리핑·기둥 분석·리서치 요약), 기본 모델 `claude-haiku-4-5`

## 2. 데이터 출처

**우리 앱에서 직접 기록**한다. 각 API 호출 1건마다 usage 이벤트를 DB에 남기고 `/usage`에서 집계한다.

제공사 자체 사용량/청구 API(Anthropic Usage & Cost Admin API, Exa Get API Key Usage, getxapi `get_account_info`/`get_payment_history`)도 존재하지만 **이번 범위에서는 사용하지 않는다.** 이유:
- 제공사 API는 모델/엔드포인트 단위까지만 알고, 이 페이지의 핵심인 **기능별 분해**(검색/키워드추천/번역/브리핑…)는 우리 앱만 아는 정보라 직접 기록으로만 나온다.
- 제공사 API는 설정 마찰이 있다(Anthropic은 Admin 키+조직 계정 전제, Exa는 팀 관리 키 별도).
- 실청구 대조는 후속 단계로 남긴다(§9 확장 지점).

## 3. 계측 설계 (호출 이벤트를 어디서 남기나)

**원칙: 기록은 실제 API 동작을 절대 막지 않는다.** 기록은 fire-and-forget(비동기, `await` 안 함)이며 실패는 조용히 삼킨다. `PGHOST` 미설정 시 no-op → 테스트/로컬에서 DB 접속 없음.

### 3.1 getxapi (`src/lib/getxapi.ts`)
`GetxapiClient`에 옵션 콜백 `onUsage?(ev)`를 추가하고, 중앙 HTTP 메서드 `get()`이 성공 응답마다 호출한다. 오퍼레이션은 경로에서 파생:

| 경로 | operation |
|---|---|
| `/twitter/tweet/advanced_search` | `getxapi.search` |
| `/twitter/user/tweets` | `getxapi.userTweets` |
| `/twitter/user/info` | `getxapi.userInfo` |
| `/twitter/tweet/detail` | `getxapi.tweetDetail` |
| `/twitter/tweet/replies` | `getxapi.replies` |
| `/twitter/tweet/thread` | `getxapi.thread` |
| `/twitter/tweet/retweeters` | `getxapi.retweeters` |

`makeClient()`가 기본 `onUsage`를 배선해 `recordUsageSafe`를 호출한다. 재시도(429/5xx)는 논리적 1콜로 집계 — 최종 성공 시 1건 기록. 테스트는 `onUsage`를 주입하지 않으므로 기록 경로를 타지 않는다.

### 3.2 Exa (`src/lib/exa.ts`)
동일하게 `ExaClient`에 `onUsage?(ev)` 추가, `post()`가 성공 시 호출 → `exa.search`. `makeExaClient()`가 배선.

### 3.3 Anthropic
`new Anthropic()`가 5개 파일(suggest·briefing·pillar·research)에 흩어져 있어, 공용 헬퍼로 통일한다.

`src/lib/llm.ts` (신규):
```ts
callLLM(operation: string, params: object, client?: AnthropicLike): Promise<res>
```
- `client ?? new Anthropic()`로 `messages.create` 호출.
- 응답의 `usage.input_tokens`/`output_tokens`·`params.model`을 `recordUsageSafe`에 기록.
- 각 호출부가 자기 operation을 넘긴다: `anthropic.suggest`, `anthropic.translateKeyword`, `anthropic.translateTags`, `anthropic.briefing`, `anthropic.pillar`, `anthropic.research`.
- 기존 `client` 주입(테스트용)은 그대로 유지. `AnthropicLike` 타입을 `usage`까지 포함하도록 넓힌다.

기존 호출부(suggest.ts 3곳, briefing.ts, pillar.ts 2곳, research.ts)를 `c.messages.create(...)` → `callLLM('...', {...}, client)`로 치환.

### 3.4 저장 헬퍼 (`src/lib/usageStore.ts`)
```ts
recordUsageSafe(ev: UsageEvent): void   // fire-and-forget, 예외 삼킴, PGHOST 없으면 no-op
```
`UsageEvent = { api, operation, ok, httpStatus?, model?, inputTokens?, outputTokens?, units }`

## 4. operation → 기능(feature) 매핑

기능 라벨은 저장하지 않고 표시 계층에서 operation으로부터 파생한다(`src/lib/usageFeatures.ts`):

| operation | 기능 라벨(사용자 언어) |
|---|---|
| `getxapi.search` | 트윗 검색 |
| `getxapi.userTweets` | 워치리스트 갱신 |
| `getxapi.userInfo` | 계정 조회 |
| `getxapi.tweetDetail` | 인용 트윗 보강 |
| `getxapi.replies` / `.thread` / `.retweeters` | 트윗 확장 탐색 |
| `exa.search` | 웹 기사 검색 |
| `anthropic.suggest` | 키워드 추천 |
| `anthropic.translateKeyword` / `.translateTags` | 번역 |
| `anthropic.briefing` | 브리핑 생성 |
| `anthropic.pillar` | 기둥 분석 |
| `anthropic.research` | 리서치 요약 |

## 5. 저장 스키마 — `migrations/009_api_usage.sql`

```sql
create table if not exists api_usage (
  id uuid primary key default gen_random_uuid(),
  api text not null,             -- getxapi | exa | anthropic
  operation text not null,       -- getxapi.search, anthropic.suggest, ...
  ok boolean not null default true,
  http_status int,
  model text,                    -- anthropic만
  input_tokens int,              -- anthropic만
  output_tokens int,             -- anthropic만
  units int not null default 1,  -- 요청/검색 수 (getxapi/exa/anthropic = 1)
  created_at timestamptz not null default now()
);
create index if not exists api_usage_created_at_idx on api_usage (created_at);
create index if not exists api_usage_api_idx on api_usage (api);
```

**비용 컬럼은 두지 않는다.** 수량(units/토큰)만 저장하고 비용은 조회 시 현재 단가로 계산 → 단가 수정 시 과거분까지 자동 재환산(§7).

## 6. 단가 (`src/lib/usagePricing.ts`) — 공식 실단가, 2026-07-20 확인

env 오버라이드 가능하게 상수로 두고 출처·확인일을 주석에 남긴다.

- **Anthropic** (모델별 USD / 1M 토큰):
  - `claude-haiku-4-5`: 입력 $1.00, 출력 $5.00 (앱 기본 모델)
  - `claude-sonnet-5`: $3 / $15, `claude-opus-4-8`: $5 / $25 (모델 변경 대비 매핑에 포함)
  - 비용 = `input_tokens/1e6 * inPrice + output_tokens/1e6 * outPrice`
  - 출처: platform.claude.com 모델 가격표
- **getxapi**: 표준 read 콜 **$0.001 / 콜**. 앱은 유료 프리미엄(생성·로그인·아티클) 미사용 → 전 오퍼레이션 표준가. 출처: getxapi.com/pricing
- **Exa**: `exa.search` **$0.007 / 콜**($7/1k). 본문(contents)은 상위 10개까지 무료이고 앱은 `numResults: 8`이라 본문비 없음. **주의 주석**: numResults를 11+로 올리면 본문비 $1/1k 추가. 출처: exa.ai/pricing

화폐: **USD 표기**. `formatMoney()`를 통해 표시하고, 후속 원화 병기를 위해 환율 자리(`KRW_PER_USD`, 현재 미사용)만 구조로 남긴다.

## 7. 비용 계산 (조회 시 계산)

`estCostUsd(row)` 하나로 계산:
- anthropic: 모델 단가표 × 토큰
- getxapi: `units × 0.001`
- exa: `units × 0.007`

과거 행도 조회 때마다 현재 단가로 계산되므로, 단가를 고치면 전 기간 표시 금액이 일관되게 갱신된다.

## 8. 페이지 `/usage` + 사이드바 링크

### 8.1 라우트
`src/app/usage/page.tsx` — 서버 컴포넌트. 최상위(워크스페이스 무관, 앱 전체 공통 지표).

기간: `searchParams`로 `7d` / `30d` / `month`(이번 달), 기본 `30d`. 기간 토글은 링크(`?period=`)로 구현.

### 8.2 구성
1. **요약 카드** — 기간 총 추정비용(USD) + API별 3장(getxapi/Exa/Anthropic 각각 비용·호출수)
2. **API별 표** — 호출수 · (Anthropic 토큰 합) · 추정비용
3. **기능별 표** — 기능 라벨 · 호출수 · 추정비용 · 비중(%)
4. **일별 추이** — 라이브러리 없이 인라인 막대(CSS/SVG). 일자별 총비용(또는 API 스택).

집계 쿼리는 `usageStore`에 함수로 둔다: `summaryByApi`, `byOperation`(→표시에서 기능으로 매핑·재합산), `dailyTrend`. 모두 `{from, to}` 파라미터.

### 8.3 UX 원칙(AGENTS.md) 반영
- 숫자에 해석·맥락: 하단에 "추정치이며 기준 단가(2026-07-20 확인)로 환산" 각주. 실청구와 다를 수 있음을 한 줄로.
- 내부 용어 대신 사용자 언어 라벨(기능 표의 한글 라벨). operation 원문은 노출하지 않거나 보조로만.
- 사이드바 하단에 "API 사용량" 링크를 조그맣게 추가(`src/components/Sidebar.tsx`, 멤버 섹션 위/아래). 최상위 `/usage`로 이동.

## 9. 확장 지점 (후속, 이번 범위 아님)

제공사 실청구 대조는 나중에 붙일 수 있도록 자리만 남긴다:
- `usagePricing`/`usageStore`는 실청구 값과 대조 가능한 형태(수량·기간)로 이미 노출.
- 후속: getxapi `get_account_info`/`get_payment_history`(MCP 연결됨), Exa Get API Key Usage, Anthropic Cost Report(Admin 키+조직 계정 필요)를 읽어 "추정 vs 실청구" 대조 섹션 추가. 이번엔 구현하지 않음.

## 10. 테스트 (TDD)

- `usagePricing`: 토큰/콜 수 → USD 비용 계산(모델별, getxapi, exa 각 케이스)
- `usageFeatures`: operation → 기능 라벨 매핑(전 케이스 + 미지 operation 폴백)
- `usageStore`: `recordUsageSafe` no-op 가드(PGHOST 없을 때 예외 없이 통과), 집계 쿼리 형태
- `format`/`formatMoney`: USD 포맷
- 계측 회귀: getxapi/exa 클라이언트 테스트가 `onUsage` 없이도 통과(기존 테스트 유지)

## 11. 비목표 (YAGNI)

- 워크스페이스별 분해 (요구 없음)
- 원화 환산 (구조만; 실제 병기는 후속)
- 제공사 실청구 API 연동 (§9 후속)
- 예산 알림/한도 설정
- 실패 호출(ok=false) 비용 계산 — 기록은 하되 비용 0, 표에서 "실패" 카운트로만 보조 표시
