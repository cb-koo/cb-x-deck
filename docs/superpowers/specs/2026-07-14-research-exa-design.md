# 리서치 (exa) — 키워드 발굴 파이프라인 설계

2026-07-14. v1.5에서 준비한 사이드바 리서치 슬롯(`/w/[wsId]/research`)에 입주하는 첫 기능.

## 목적과 위치

덱의 검색 컬럼은 "무슨 키워드로 볼 것인가"가 정해져야 돌아간다. 리서치 기능은 그 상류 —
**웹 기사(일본 뷰티 트렌드·시술 담론·まとめ/ランキング)를 시맨틱 검색해 덱 검색용
키워드·훅 후보를 발굴하고, 클릭 몇 번으로 검색 컬럼까지 만드는 파이프라인**이다.

- exa는 x.com을 색인하지 않는다(7/7 실측, 403 명시 거부) → 트윗 검색은 getxapi(덱) 담당,
  exa는 **웹 기사 발굴 전용**. 두 채널은 상호보완.
- 발굴 방법론은 X콘텐츠발굴 플레이북 v1.1을 따른다: 토픽어만이 아니라 **훅 구조어**도
  추출 대상(컨트래리언·聞き出し型 등이 참여 4.9배).

## MVP 범위 (이번 구현)

**흐름**: 주제 입력 → exa 검색(일본어 기사 위주) → 결과 카드 목록 → 카드별 "키워드 추출"
→ Claude가 토픽 키워드 + 훅 후보를 ja/ko 병기로 추출 → 칩 선택 → "컬럼 만들기" →
검색 컬럼 생성(현재 워크스페이스) → 덱 링크.

리서치 결과는 **저장하지 않는다**(세션 한정). 영속화는 구조화 리포트 단계로 이연.

## 발전 경로 (설계 제약으로만 반영)

이후 "구조화 리서치 리포트"(브랜드/경쟁사명 → 다중 검색 + Claude 종합 → 리포트)로
확장한다. 이를 위해:
- exa 클라이언트는 범용으로 유지(search 옵션 노출: numResults·도메인·기간·본문 길이)
- 추출 프롬프트는 research.ts에 모듈로 분리 — 리포트는 "다중 검색 오케스트레이션 +
  종합 프롬프트" 레이어만 추가하면 됨
- 영속화가 필요해지면 research_run 테이블 신설(지금은 만들지 않음)

## 구성 요소

1. **`src/lib/exa.ts`** — ExaClient. `POST https://api.exa.ai/search`(x-api-key),
   `search(query, opts)` → `[{title, url, publishedDate, text}]`. `contents.text`를 검색
   요청에 포함해 본문을 한 번에 받는다(별도 contents 호출 없음). 재시도(429/5xx 백오프)·
   401 구분은 getxapi.ts 패턴을 따른다. `makeExaClient()`는 `EXA_API_KEY` 필수.
2. **`src/lib/research.ts`** — `extractKeywords({title, text}, client?)` → Claude Haiku →
   `{ keywords: KwPair[], hooks: KwPair[] }` (suggest.ts의 KwPair·extractJson 패턴 재사용).
   keywords = X 검색용 토픽어, hooks = 기사 속 담론에서 뽑은 훅 구조어/구문.
3. **API 라우트** (키는 서버에만):
   - `POST /api/research/search` `{query}` → 한글 감지 시 기존 `translateKeyword`로 일본어
     변환 후 exa 검색(numResults 8, 본문 2000자) → 결과 배열(+적용된 질의 표기용 반환)
   - `POST /api/research/extract` `{title, text}` → `{keywords, hooks}`
4. **UI `research/page.tsx`** — 검색창(IME isComposing 가드+진행중 잠금) → 결과 카드
   (제목·도메인·날짜·발췌, 원문 링크) → 카드별 [키워드 추출] → 칩(ja(ko) 병기, 토픽/훅
   구분 표시, 클릭 토글) → 하단 선택 트레이 → [컬럼 만들기] → `POST /api/columns`
   (kind=search, keywords=선택 ja들, title=자동 병기, 나머지 ColumnSettings 기본값과 동일:
   minFaves 300·lang ja·imagesOnly·maxPages 3·sort views) → 성공 시 덱 링크 토스트.
5. **환경**: `.env`에 `EXA_API_KEY` 추가(로컬 exa MCP 설정에 있던 기존 키 재사용),
   README env·비용 섹션 갱신(검색 1회 ≈ $0.005 + 추출 Haiku 소액).
6. **스모크**: `npm run smoke:exa` — 실호출 1회로 계약 검증(스키마 변화 감지용, ~$0.005).

## 검증

- 단위: exa 클라이언트(fetch mock — 정상/401/429 재시도/5xx 소진), extractKeywords
  (AnthropicLike fake — 정상 JSON/비정상 응답 fallback).
- 실브라우저 E2E: 검색 → 카드 → 추출 → 칩 선택 → 컬럼 생성 → 덱에서 컬럼 확인.

## 만들지 않는 것

- 리서치 결과·히스토리 영속화, 구조화 리포트, exa Websets/findSimilar, 기사 전문 뷰어,
  덱 페이지 개입(컬럼 생성은 기존 POST 재사용).
