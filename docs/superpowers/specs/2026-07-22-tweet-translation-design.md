# 트윗 번역 (JA→KR) 설계

작성일: 2026-07-22

## 배경 / 문제

덱은 일본어 트윗만 수집·표시한다. 한국 콘텐츠 기획팀원이 원문을 읽기 불편하다는 요청이 들어왔다.
번역 기능을 붙여 일본어 트윗 본문을 한국어로 볼 수 있게 한다.

이 도구는 **비개발 콘텐츠 기획 담당자**용 벤치마크 리서치 도구다(AGENTS.md UX 원칙 적용). 번역은
"대충 뜻만"이 아니라 미용/미용의료 맥락에서 정확해야 하며, 원문 확인(특히 薬機法 민감 용어)이
가능해야 한다.

## 기존 자산 (재사용)

- `@anthropic-ai/sdk` 이미 의존성. 모든 LLM 호출은 `src/lib/llm.ts`의 `callLLM(operation, params, client?)`
  단일 통로를 지나며 토큰 사용량을 자동 기록(`recordUsageSafe`).
- 이미 JA→KR 번역 패턴 존재: `src/lib/suggest.ts`의 `translateTags()`(해시태그 번역), `extractJson()`,
  `MODEL()`(기본 `claude-haiku-4-5-20251001`).
- 브리핑 기능이 참고 모델: LLM 생성물을 DB에 캐시(`migrations/008_briefing.sql`)해 재열람 무료.
- 트윗 본문: `tweet.text` 컬럼 → `TweetCard`(`src/components/TweetCard.tsx:75`) → `TweetText`
  (`src/components/TweetText.tsx`, 멘션/해시태그/URL 링크화) 로 렌더.
- 인용 트윗: `quoted` jsonb, `QuotedCard`로 렌더.

## 리서치 근거 (exa)

- **Opt-in + 원문 병기가 업계 표준**: X·FB·IG·Reddit 모두 기본 원문, "번역 보기"를 눌러야 번역.
  MT 오류 때문에 원문을 항상 남긴다. 2026-03 X의 Grok 자동번역이 "번역이 보이지 않아 저자의
  정확한 표현으로 오인"된다는 비판(Unseen Japan) → 벤치마크 도구에선 **원문 보존 + "AI 번역" 표식** 필요.
- **하이브리드는 실제 제품의 귀결점**: Fenly = 트윗별 버튼 + (Pro) 피드 전체 자동번역.
- **LLM 번역 품질 레버(공통)**: ①도메인 용어집이 최고 레버 ②"그냥 번역" 금지·보존 규칙 명시
  (해시태그·멘션·제품명·숫자) ③콘텐츠 주소 캐시(원문+프롬프트 지문 키) ④배치가 일관성·비용에 유리
  ⑤대량엔 저렴·결정적 모델(Haiku 적정).

## 결정 사항 (사용자 확정)

- **하이브리드**: 컬럼 "전체 번역"(배치·캐시 채움) + 카드별 토글(캐시 히트 시 즉시). 비용은 결정 요인이
  아님(컬럼 통째 ≈ $0.05~0.16, 캐시로 트윗당 평생 1회) — 갈림길은 시간×클릭이라 둘을 겸함.
- **표시 방식**: 원문 아래 번역을 추가(접기 가능). 원문 항상 보존.
- **용어집**: 가볍게 시작 — 미용/미용의료 핵심 용어 소량을 프롬프트에 내장(별도 DB·UI 없음).
- **모델**: Haiku 4.5(앱 기본). 티어링·상위 모델 승격은 나중.

## 아키텍처

### ① 데이터 모델 — `migrations/011_translation.sql`

```sql
create table if not exists tweet_translation (
  tweet_id       text primary key references tweet(tweet_id) on delete cascade,
  target_lang    text not null default 'ko',
  source_hash    text not null,   -- 번역한 원문(본문[+인용본문])의 해시
  prompt_version int  not null,   -- 프롬프트/용어집 버전 (바뀌면 캐시 무효)
  content        text not null,   -- 본문 한국어 번역
  quoted_content text,            -- 인용 트윗 본문 번역(있으면)
  model          text,
  created_at     timestamptz not null default now()
);
```

- 캐시 키 = `tweet_id`(+ `target_lang` 고정 'ko'). 읽을 때 `source_hash`·`prompt_version`이 현재 값과
  일치할 때만 히트. 불일치(트윗 수정 / 용어집 개정)면 miss로 처리 → 재번역·덮어쓰기.
- `source_hash` = 번역 입력이 된 문자열(본문 + 인용 본문 결합)의 안정적 해시. 트윗 수정 감지용.
- 현재 `target_lang`은 항상 'ko'지만 컬럼으로 남겨 다국어 확장 여지 확보(범위 밖).

### ② 로직 — `src/lib/translate.ts`

기존 `suggest.ts`/`briefing.ts` 스타일.

- `export const PROMPT_VERSION = 1` — 프롬프트/용어집을 고칠 때마다 +1(캐시 무효 트리거).
- 입력 타입: `{ tweetId: string; text: string; quotedText?: string | null }`.
- `translateTweets(tweets, client?)`: 트윗을 **배치**로 묶어 `callLLM('anthropic.translate', …)` 호출.
  - 청크 크기 상수(예: `CHUNK = 20`). 컬럼 200건은 청크로 나눠 `Promise.all` 병렬(단일 대형 호출은
    출력 토큰 과다·타임아웃 위험).
  - 프롬프트(한국어): 일본어 미용/미용의료 X 트윗을 한국 기획팀용 자연스러운 한국어로 번역. 규칙:
    **@멘션·#해시태그·URL·숫자·이모지는 그대로 보존**, 톤 유지, 직역 금지·업계 통용 표현.
    **미용/미용의료 핵심 용어집 소량 내장**(예: 毛穴→모공, キメ→피부결, 薬機法→약기법, 시술/성분 통칭).
  - 각 트윗을 번호로 나열(브리핑의 `[T번호]` 방식 참고). 인용 트윗 본문이 있으면 함께 제시.
  - 출력: JSON `{ "<id>": { "body": "...", "quoted": "..."|null }, ... }`. `extractJson`으로 파싱.
  - 검증: id가 입력에 존재하고 `body`가 문자열인 항목만 채택(브리핑의 방어적 검증 방식). 파싱 실패·
    누락 건은 조용히 건너뛰고 부분 성공 반환(반쪽 실패가 전체를 막지 않게).
  - 반환: `Map<tweetId, { content: string; quotedContent: string | null }>`.

### ③ 스토어 — `src/lib/translationStore.ts`

- `getTranslations(sql, tweetIds, { promptVersion, sourceHashes })`: 캐시 조회. `source_hash`·
  `prompt_version` 일치 행만 반환.
- `upsertTranslations(sql, rows)`: `insert … on conflict (tweet_id) do update`(브리핑/트윗 스토어와 동일 관례).
- `hashSource(text, quotedText)`: 해시 헬퍼(결정적, 순수 함수 — 단위 테스트 대상).

### ④ API — `POST /api/tweets/translate`

- `src/app/api/tweets/translate/route.ts`. `requireAllowedUser` 게이팅(기존 라우트와 동일).
- body: `{ tweetIds: string[] }`. 상한(예: 최대 200)으로 남용 방지.
- 처리: (1) 대상 트윗 본문/인용 로드 → 각 `source_hash` 계산 (2) `getTranslations`로 캐시 히트 분리
  (3) 미스만 `translateTweets`로 번역 → `upsertTranslations` (4) 캐시 + 신규를 합쳐 map 반환:
  `{ translations: { "<id>": { content, quotedContent } } }`.
- **카드 1건이든 컬럼 전체든 같은 라우트**(하이브리드). 사용량·비용은 `callLLM`이 자동 기록.

### ⑤ UI

거짓 어포던스 방지 + 원문 보존(AGENTS.md 원칙).

- `TweetCard`:
  - 원문(`TweetText`) **항상 유지**.
  - 그 아래 **접이식 번역 블록** — **"🌐 AI 번역"** 표식(자동 기계번역임을 명시) + `원문만 보기` 토글.
  - 미번역 상태: `번역` 고스트 버튼(기대 설정 한 줄 도움말: "이 카드를 한국어로").
- `QuotedCard`: 인용 트윗 본문도 동일하게 번역 표시(`quotedContent`).
- `Column` 헤더: **`전체 번역`** 버튼 → 로드된 트윗 전부 번역(진행 표시 후 각 카드 반영),
  이후 `번역 숨기기`/`전체 번역` 토글. 라벨은 이득 언어로(내부 개념어 금지).
- 번역 상태는 `Column`에서 관리(tweetId→번역 map)해 카드 버튼과 전체 번역이 **같은 캐시 공유**.
  카드 버튼 클릭도 동일 라우트를 1건으로 호출해 map에 병합.
- (선택, 범위 밖 여지) "번역 자동 표시" 개인 설정 localStorage — 반복 마찰이 확인되면 추가.

## 데이터 흐름

```
[전체 번역 클릭]  Column → POST /api/tweets/translate {ids: 로드된 전부}
[카드 번역 클릭]  TweetCard → Column 핸들러 → POST /api/tweets/translate {ids: [1건]}
                         │
                         ▼
        route: 본문 로드 → source_hash 계산 → getTranslations(캐시 히트)
                         │ 미스만
                         ▼
        translate.ts: 청크 배치 → callLLM(Haiku) → JSON 파싱·검증
                         │
                         ▼
        upsertTranslations(DB 캐시)  →  {translations map} 반환
                         │
                         ▼
        Column state 병합 → 각 TweetCard/QuotedCard 번역 블록 렌더
```

## 에러 처리

- 번역 실패(파싱 불가/부분 실패): 성공분만 반환, 실패 건은 카드에 "번역 실패 — 다시 시도" 표시하고
  원문 유지(기존 `translate-keyword` 라우트의 502/재시도 톤과 일치).
- 서로게이트/이모지: `callLLM`이 이미 lone surrogate 제거 처리(`llm.ts`).
- Rate limit: 청크 병렬이 순간 호출을 늘리므로 청크 크기·동시성 상한을 보수적으로(예: 청크 20, 동시 ≤5).
- 남용: 라우트 `tweetIds` 상한.

## 테스트 (기존 관례: 단위 + 실 Supabase 통합, `test-` 접두 자가 정리)

- `translate.test.ts`(mock client): JSON 파싱/검증, **해시태그·멘션·URL 보존** 회귀, 부분 실패 처리,
  인용 본문 포함.
- `translationStore.test.ts`(실 DB): upsert/조회, `source_hash`·`prompt_version` 게이팅(불일치 시 miss),
  `hashSource` 결정성.
- (선택) `scripts/smoke-translate.ts` + `npm run smoke:translate`: 실호출 계약 검증(소액).

## 비용 특성

- Haiku 4.5 = 입력 $1 / 출력 $5 (per 1M). 트윗 1건 ≈ $0.001, 컬럼 60건 ≈ $0.05, 200건 ≈ $0.16.
- 캐시로 트윗당 **평생 1회**만 비용(원문·용어집 불변 시). GetXAPI 새로고침($0.003)·브리핑보다 훨씬 저렴.
- 버튼 opt-in(비용 유발 액션). 반복 마찰이 실사용으로 확인되면 자동번역 승격 검토(AGENTS.md 6번).

## 범위 밖 (YAGNI, 나중에)

- 원문 완전 대체 모드
- 역번역 QA / 품질 점수
- 편집 가능한 용어집 UI, 용어집 DB 테이블
- 새로고침 시 자동번역, "번역 자동 표시" 승격
- ko 외 다국어 (`target_lang` 컬럼으로 여지만 확보)
- 상위 모델 티어링/승격
```
