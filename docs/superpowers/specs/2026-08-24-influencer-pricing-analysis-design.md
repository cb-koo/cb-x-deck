# 인플루언서 프로필: 협찬 단가 + 계정 분석 — 설계 스펙

- 날짜: 2026-08-24
- 브랜치: `cb-koo/influencer-profile`
- 배경: 인플루언서 명부 v1(마이그레이션 024·025) 위에 새 정보 2종을 얹는다. 게시물 성과 연결은 **다음 작업으로 보류**(이 스펙 범위 아님). 프로필 페이지 전면 개편도 나중 — 이번엔 섹션 추가만.

## 0. 목적

1. **협찬 단가**: 유형별(RT·인용RT·투고·방문협찬) 건당 단가를 구조화해 관리하고, 변경 이력을 남겨 협상 때 이전 단가를 근거로 쓴다. (지금은 고정 메모에 자유 서술뿐)
2. **계정 분석**: 이 계정이 올리는 콘텐츠의 주제·성향·반응 수준을 X에서 최근 글을 받아와 분석한다 — "확산용 계정으로 적합한가"와 "어떤 글이 반응이 좋은가"(원고 기획 참고)에 답한다.

## 1. 화면 배치 (`InfluencerProfile` 섹션 순서)

```
헤더(아바타·핸들·팔로워·프로필 갱신)     ← 기존
현황 스트립(팔로업 배지·원고 요약)        ← 기존
[신설] 계정 분석                          ← "어떤 계정인가"는 위쪽
태그 · 고정 메모                          ← 기존
[신설] 협찬 단가                          ← 상업 조건 — 고정 메모 아래 인접
주고받은 기록 · 넘긴 원고 · 제거          ← 기존
```

## 2. 협찬 단가 섹션

### 데이터

- `influencer.pricing jsonb not null default '{}'`:
  ```json
  { "currency": "KRW" | "JPY", "rt": number|null, "quoteRt": number|null, "post": number|null, "visit": number|null }
  ```
  빈 객체 = 아무것도 입력 안 함. 각 유형 null/부재 = 미정/미진행. 금액은 정수(원·엔 단위). `currency` 부재 = KRW로 간주(UI 기본 선택과 일치, diff 계산도 같은 규칙).
- 유형 키·라벨 상수는 lib 한 곳에 (`PRICING_TYPES`: rt=RT, quoteRt=인용RT, post=투고, visit=방문협찬).

### UI

- 유형 4행: 라벨 + 금액 입력칸(공란 placeholder "미정"). 섹션 상단 통화 선택 1개(₩ 기본, ¥) — 계정 단위, 유형별로 갈리지 않는다.
- 저장은 blur 시(고정 메모 관례), **값이 실제로 바뀐 경우에만** PATCH·기록. 저장 중 재전송 금지(태그 관례).
- 도움말 한 줄: "유형별 1건당 단가예요. 바꾸면 아래 기록에 변경 이력이 남아요."
- 각 유형 행 옆 ▸ 펼침: 그 유형의 변경 이력만 시간순 — 이미 받아온 `logs`를 필터해 렌더(추가 API 없음).
- 금액 표시는 천 단위 구분(예: 300,000원 / 30,000엔).

### 변경 이력

- `influencer_log`에 auto 이벤트 **`pricing_changed`** 추가 (event_type check 확장).
- payload: `{ "priceType": "rt"|"quoteRt"|"post"|"visit"|"currency", "from": number|string|null, "to": number|string|null, "currency": "KRW"|"JPY" }`
  - 통화 변경도 한 줄로 기록(priceType: "currency", from/to에 통화 코드).
  - 로그에는 사실만 — 표시 문구("투고 단가 300,000원 → 350,000원")는 UI(`autoText`)가 만든다(기존 관례).
- PATCH 한 번에 여러 유형이 바뀌면 유형별로 한 줄씩 기록(펼침 필터가 유형 단위이기 때문).
- 타임라인에서 pricing_changed는 다른 auto와 동일하게 회색 한 줄 + 인접 묶음(`groupText`에 케이스 추가).

### API

- `PATCH /api/influencers/[id]` 확장: body에 `pricing` 수용(zod-style 검증: 알려진 키만, 금액은 0 이상 정수 또는 null).
- 같은 트랜잭션에서: 현재 pricing 읽기(행 잠금) → diff 계산 → 변경분만 로그 insert → pricing 저장. diff 계산은 순수 함수(`diffPricing`)로 분리해 단위 테스트.

## 3. 계정 분석 섹션

### 트리거·UX

- 미분석: "계정 분석" 버튼(primary) + 도움말 "최근 3개월 글(최대 100건)을 X에서 받아와 주제·반응 수준을 분석해요 — 1~2분 걸려요." 비용 액션 opt-in(AGENTS.md ⑥).
- 실행 중: 버튼 잠금 + "분석 중…(1~2분)". 실패: 안내띠 + 기존 결과 보존(refresh의 loadErr 관례).
- 분석됨: 결과 표시 + "다시 분석" 버튼(subtle) + 분석 기준 캡션.
- `x_user_id`가 없으면 분석이 먼저 `getUserInfo` 1콜로 해결하고 진행 — 버튼 두 번 누르게 하지 않는다. 이때 refresh 라우트의 3분기 규칙(정상/handle_taken/not_found)을 **공유 함수로 추출해 재사용**하고, handle_taken/not_found면 분석을 중단하고 refresh와 같은 문구로 안내한다(같은 사실을 두 문구로 말하지 않는다).

### 표본

- 최근 **100건 ∩ 최근 3개월** — 먼저 걸리는 쪽에서 자름. 페이지네이션 중 3개월보다 오래된 트윗을 만나면 중단.
- 표본이 얇으면 오류가 아니라 판단: 업로드 빈도가 정식 분석 항목("최근 3개월 8건 — 주 1회 미만으로 활동이 적은 편이에요. 확산용 계정으로는 신중히 볼 필요가 있어요").
- 표본 0건(3개월 내 무활동)도 분석 결과로 저장·표시한다("최근 3개월 게시물이 없어요") — LLM 단계는 건너뜀.

### 파이프라인 (POST /api/influencers/[id]/analyze)

1. **수집** — `TweetSource.fetchRecent(userId, {maxCount: 100, since})`. getxapi 구현은 `getUserTweets` 커서 페이지네이션(최대 10페이지 가드).
2. **코드 집계** — 원글/RT/인용 구성비, 업로드 빈도(주당 건수), 반응 중앙값(조회·좋아요; **원글+인용만, 순수 RT 제외** — RT의 지표는 원작자 것).
3. **트윗 단위 분류** (분류 모델, 25건 청크, temperature 0) — 원글+인용만 대상. 축 분리:
   - `contentType`: 닫힌 enum — `info`(정보) | `review`(후기·체험) | `daily`(일상·잡담) | `promo`(홍보·협찬) | `other`
   - `sponsored`: boolean + **근거 문구 인용 필수**(`evidence`: #PR·광고 표기·제품 언급 원문 조각; sponsored=false면 null)
   - `topics`: 자유 태그 1~3개
   - 입출력 모두 트윗 id 포함 → id 대조로 누락 검출 → 누락분만 1회 재호출 → 그래도 빠지면 빠진 만큼 표본 수에 반영해 표시.
4. **태그 정규화** (분류 모델 1콜) — 자유 태그 전체 목록을 주고 동의어 병합 → 계정당 대표 태그 3~5개 + 각 태그가 흡수한 원태그 매핑을 받는다.
5. **코드 통계** — 대표 태그별 건수·조회 중앙값, contentType 분포, 협찬 건수.
6. **종합 서술** (종합 모델 1콜) — 위 통계 전부 + 반응 상위 10건 원문을 넣고 JSON으로:
   - `tone`: 성향·톤 요약 2~3문장
   - `patterns`: 반응 잘 나오는 글 패턴 1~2문장(통계 근거 기반)
   - `sponsorship`: 협찬 관찰 1~2문장(건수·근거 인용 언급, 관찰 없으면 "관찰되지 않음")

### 저장

- `influencer.analysis jsonb` + `analyzed_at timestamptz`. 최신 1건만(재분석 덮어씀).
- analysis 형태:
  ```json
  {
    "sample": { "count": 87, "classified": 74, "since": "...", "until": "...", "months": 3 },
    "stats": { "perWeek": 6.7, "medianViews": 12000, "medianLikes": 210,
               "mix": { "original": 61, "retweet": 22, "quote": 4 },
               "typeDist": { "review": 30, "info": 18, ... }, "sponsoredCount": 5 },
    // mix·typeDist·count류는 전부 "건수"다(비율 아님) — 비율·판단문은 UI가 파생한다

    "topics": [ { "tag": "미용의료", "count": 32, "medianViews": 12400 }, ... ],
    "summary": { "tone": "...", "patterns": "...", "sponsorship": "..." },
    "models": { "classify": "claude-haiku-4-5", "synth": "claude-sonnet-5" }
  }
  ```
- **저장은 파이프라인 전체 성공 시 1회(all-or-nothing)** — 수집·LLM 동안 DB 커넥션·트랜잭션을 잡지 않는다(풀 고갈 전례).
- 실행 시간 대비: 라우트에 `export const maxDuration = 300`.
- 동시 실행: 클라이언트 버튼 잠금으로 충분(소수 사용자 도구). 서버는 마지막 저장이 이긴다.

### 결과 UI (읽기 전용)

- 분석 기준 캡션: "최근 87건 · 5/26~8/24 기준 · 8/24 분석" (+ 분류 누락이 있으면 "이 중 74건 분석됨")
- 수치 스트립: 빈도·반응 중앙값·구성비 — **숫자마다 판단문**(예: "주 6.7건 — 활발한 편" / "조회 중앙값 1.2만 — 팔로워 규모 대비 보통"). 판단 로직은 `influencerJudgment.ts`에 순수 함수로(기존 관례, 라벨-값 일치).
- 주제 태그: 칩 + "32건 · 조회 중앙값 1.2만" 병기.
- 서술 3블록: 성향·톤 / 반응 패턴 / 협찬 관찰.
- 사람의 판단·메모는 기존 태그·고정 메모에 — 분석 결과와 섞지 않는다.

## 4. 교체 가능 경계 (요구사항)

- **`TweetSource`** (수집): `fetchRecent(userId, opts) → AnalysisTweet[]`. 구현 1호 getxapi. `AnalysisTweet` = `{ id, text, createdAt, kind: 'original'|'retweet'|'quote', views, likes, hasMedia }`.
  - **주의: `mapRawTweet` 재사용 불가** — 순수 RT를 버린다(`retweeted_tweet → null`). 분석용 매핑을 별도로 두되 필드 파싱 헬퍼는 공유. RT는 `kind`만 필요(빈도·구성비용), 본문·지표는 쓰지 않는다.
- **`AnalysisChat`** (LLM): `complete({system, user, maxTokens, temperature}) → string`. 구현 1호는 기존 `callLLM` 래핑(Anthropic, 사용량 기록 포함). OpenRouter 등은 이 인터페이스 층에서 교체(OpenAI 호환 스키마라 SDK 아래 교체 불가).
- 모델 env: `ANALYSIS_CLASSIFY_MODEL`(기본 `claude-haiku-4-5`), `ANALYSIS_SYNTH_MODEL`(기본 `claude-sonnet-5`).
- 파이프라인 본체는 두 인터페이스만 의존하는 순수 오케스트레이션 함수 — 페이크 주입으로 단위 테스트.

## 5. 마이그레이션 (028)

```sql
alter table influencer add column pricing jsonb not null default '{}';
alter table influencer add column analysis jsonb;
alter table influencer add column analyzed_at timestamptz;
-- 024에서 인라인 check로 만든 제약 — 자동 명명 규칙상 influencer_log_event_type_check.
-- 마이그레이션 작성 시 실제 이름을 프로덕션에서 확인 후 반영한다.
alter table influencer_log drop constraint influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed'));
```

## 6. 기존 코드 접점

- `influencerStore.ts`: `InfluencerRow`에 pricing/analysis/analyzedAt 추가(SELECT·toRow), `InfluencerLogRow.payload` 타입 확장, `updateInfluencer`에 pricing 경로, `pricing_changed` 로그 insert 함수.
- `InfluencerProfile.tsx`: 섹션 2개 추가, `autoText`/`groupText`에 pricing_changed 케이스.
- `influencerJudgment.ts`: 빈도·반응 수준 판단 순수 함수 추가.
- `usageFeatures.ts`: anthropic 신규 operation 라벨 추가(예: `influencer.classify`/`influencer.synth` → "계정 분석"). getxapi `userTweets`는 기존 "인플루언서 갱신" 라벨 공유(수용 — 과금 구분 필수 아님).
- refresh 라우트: 3분기(정상/handle_taken/not_found) 판정을 lib 함수로 추출, refresh·analyze가 공유.

## 7. 오류 처리 요약

| 상황 | 동작 |
|---|---|
| 수집 실패(getxapi 5xx) | 502 + "X에서 글을 가져오지 못했어요 — 잠시 후 다시 시도해 주세요", 기존 분석 보존 |
| 핸들 소멸/양도 | refresh와 동일 문구, 분석 중단 |
| 분류 청크 실패 | 1회 재시도 → 실패분 제외하고 진행, 표본 수에 명시 |
| 종합 서술 실패·JSON 파싱 실패 | 전체 실패 처리(저장 안 함) — 반쪽 결과를 저장하지 않는다 |
| LLM 거절(LLMRefusalError) | "분석이 거절됐어요" 평문 안내(기존 관례) |
| 3개월 내 0건 | 정상 결과로 저장 — "게시물이 없어요" + 빈도 판단 |

## 8. 검증

- 순수 로직 단위 테스트(tsx 단일 파일): 통계 집계(중앙값·구성비·빈도), 청크 분할·id 대조·누락 재시도 판정, 태그 병합 적용, `diffPricing`, 판단 함수, LLM 출력 파싱(불량 JSON 포함).
- 스토어 테스트(실 DB, npm test): pricing PATCH→로그 기록, analysis 저장·조회, event_type check 확장.
- 파이프라인 오케스트레이션: TweetSource·AnalysisChat 페이크 주입 테스트.
- 화면: koo QA(OAuth 게이팅). 로컬은 build + start(-p 3001) + 127.0.0.1.
- 린트 기준선 24개 유지, npm test 전체 통과, build 통과.

## 9. 범위 밖 (명시)

- 게시물 성과(트래킹 데이터) 연결 — 다음 작업.
- 프로필 페이지 전면 개편(설명형 재구성) — 나중.
- 분석 이력 보관·비교, 자동 주기 분석 — 요구 없음(YAGNI).
- 인플루언서별 통화 혼용(유형별 통화 분리) — 계정 단위 통화 1개로 충분.
