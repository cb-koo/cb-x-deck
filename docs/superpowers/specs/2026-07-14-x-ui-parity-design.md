# cb-x-deck UI 개선 — X.com 패리티 + 칼럼 설정 재설계

날짜: 2026-07-14
상태: 승인됨 (박구건, 접근 A + 정규식 링크화 + 넓은 모달)

## 배경 / 문제

실사용 피드백 두 가지:

1. **덱 UI가 실제 X UI와 동일했으면 좋겠다.** 현재 TweetCard만 X 라이트모드 팔레트로 스타일링돼 있고, 사이드바·칼럼 헤더·설정 모달·보관함은 일반 회색 Tailwind + `dark:` 변형이 혼재한다. 시스템이 다크모드면 트윗 카드만 하얗게 떠서 어색하다.
2. **칼럼 추가/설정 모달이 협소하다.** 폭 380px 고정에 작은 입력 필드가 2열로 빽빽해 보거나 설정하기 불편하다.

추가로 X 공식 Display Requirements(docs.x.com/developer-terms/display-requirements)와 대조한 결과, 트윗 카드에 다음이 빠져 있다:

- 작성자(아바타·이름·@핸들) → X 프로필 링크
- 타임스탬프 → 트윗 원문(permalink) 링크 (#timelines 섹션의 핵심 요구)
- 본문 속 @멘션·#해시태그·URL 링크화 (현재 전부 일반 텍스트, t.co 원시 URL 노출)

## 결정 사항

| 결정 | 내용 |
|---|---|
| 디자인 기준 | **X.com 본체 라이트모드** (X Pro/TweetDeck 아님) |
| 다크모드 | **라이트 고정** — `dark:` 변형 전부 제거, 시스템 설정 무시 |
| 구현 방식 | **접근 A: 디자인 토큰** — Tailwind `@theme`에 X 팔레트 변수 정의, 컴포넌트는 토큰 클래스 사용 |
| 본문 링크화 | **정규식 기반** — 엔티티 저장(DB 마이그레이션)은 이번 범위 제외 |
| 설정 UI | **넓은 모달 (~600px)** — 사이드 패널/인라인 칼럼 아님 |

### 범위 제외 (YAGNI)

- t.co → 원본 도메인 표시(display_url): 수집 파이프라인에 엔티티 저장 필요, 기존 트윗 소급 불가. 링크는 클릭 가능하게만.
- 리포스트 "reposted by" 표기, 포스트 수정(edit) 이력, X 로고 표시: 사내 도구라 제외.
- Chirp 폰트 번들, 픽셀 단위 애니메이션 복제: 시스템 폰트 스택으로 충분.
- 다크모드 팔레트: 토큰 구조상 나중에 변수 교체로 추가 가능하게만 설계.

## 설계

### 1. 디자인 토큰 (`src/app/globals.css`)

Tailwind v4 `@theme`에 X 라이트모드 팔레트 정의:

```css
@theme {
  --color-x-text: #0f1419;        /* 본문 */
  --color-x-secondary: #536471;   /* 보조 텍스트 */
  --color-x-muted: #8b98a5;       /* 메타/희미한 텍스트 */
  --color-x-border: #eff3f4;      /* 옅은 경계 */
  --color-x-border-strong: #cfd9de; /* 입력필드/인용 경계 */
  --color-x-blue: #1d9bf0;        /* 링크/액션 */
  --color-x-blue-hover: #1a8cd8;
  --color-x-green: #00ba7c;       /* 리포스트 */
  --color-x-pink: #f91880;        /* 좋아요 */
  --color-x-hover: #f7f9f9;       /* 행/버튼 hover 배경 */
}
```

- `body` 폰트를 X 스택(`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`)으로 변경 — TweetCard의 인라인 font-family 제거.
- `:root`의 다크모드 `@media (prefers-color-scheme: dark)` 블록 제거, 배경 `#ffffff` 고정.
- 사용처: `text-x-text`, `border-x-border`, `hover:bg-x-hover` 등 토큰 클래스. 컴포넌트 내 하드코딩 hex(`#0f1419` 등)는 전부 토큰으로 이관.

### 2. 트윗 카드 anatomy 보강 (`TweetCard.tsx` + 신규 `TweetText.tsx`)

Display Requirements 대조 보강:

- **작성자 링크**: 아바타·이름·@핸들을 `<a href="https://x.com/{handle}" target="_blank">`로 감싼다. 이름에 hover 밑줄(X 동작).
- **타임스탬프 링크**: `timeAgo` 텍스트를 `tweetUrl`로 링크(`target="_blank"`, hover 밑줄). `tweetUrl`이 null이면 일반 텍스트 유지. 하단 "원문↗" 버튼은 타임스탬프 링크와 중복되므로 제거.
- **본문 링크화**: 신규 `TweetText` 컴포넌트 — 텍스트를 토큰으로 분해해 렌더:
  - `@handle` → `https://x.com/{handle}` (영숫자+underscore, 1~15자)
  - `#태그` → `https://x.com/search?q=%23태그` (한글·일본어·영숫자 지원 — 일본 뷰티 트윗이 주 대상)
  - `https?://...` URL → 해당 URL로 링크
  - 링크 색 `text-x-blue`, hover 밑줄. 나머지 텍스트는 `whitespace-pre-wrap` 유지.
  - 토크나이저는 순수 함수 `tokenizeTweetText(text): Token[]`로 분리(`src/lib/tweetText.ts`), vitest 단위 테스트 작성.
- 인용 트윗(quoted) 본문에도 동일한 `TweetText` 적용.

### 3. 칼럼 설정 모달 재설계 (`ColumnSettings.tsx`)

폭 380px → **600px** (`w-[600px] max-w-[90vw] max-h-[90vh]`), 화면 중앙 유지.

구조 (위→아래):

1. **헤더**: 제목("새 칼럼"/"칼럼 설정") + 우상단 ✕ 닫기 버튼
2. **유형 선택** (신규 생성 시만): 검색/워치리스트 — X식 세그먼트(선택=검정 필, 비선택=회색 테두리 필)
3. **키워드 섹션** (검색일 때): 큰 입력필드(`text-[15px] py-2.5`) + Enter 추가, 칩 목록(X식 rounded-full), "연관 제안" 버튼과 제안 결과
4. **필터 섹션**: 구분선 + 섹션 라벨("필터") 아래 2열 그리드, 각 필드는 라벨 13px + 넓은 입력(py-2.5). 최소 좋아요 / 최소 조회수 / since / until / 이미지만 체크박스
5. **고급 섹션**: 구분선 + "고급" 라벨 — 언어, 페이지 상한, 칼럼 이름(비우면 자동)
6. **푸터**: 취소(테두리 필) / 만들기·저장(검정 필 `bg-x-text text-white rounded-full`)

워치리스트일 때는 3~5 대신: 계정 핸들(큰 입력) + 고급(페이지 상한, 칼럼 이름).

입력필드 공통 스타일: `rounded-md border-x-border-strong`, focus 시 `border-x-blue ring-1 ring-x-blue`. 기존 로직(한국어 번역, IME 가드, 제안, 검증)은 그대로 유지 — 레이아웃/스타일만 변경.

### 4. 전체 라이트 통일 + X 룩앤필 (나머지 컴포넌트)

대상: `Sidebar.tsx`, `Column.tsx`(헤더·정렬 탭·load-more), `CooccurrencePanel.tsx`, `CandidateCard.tsx`, `library/page.tsx`, `w/[wsId]/page.tsx`, `debug/card/page.tsx`.

`research/page.tsx`는 **제외** — 진행 중인 exa 리서치 작업의 미커밋 수정분이 걸려 있어, 그 작업이 커밋된 뒤 별도로 토큰 스타일을 입힌다.

- 모든 `dark:` 클래스 제거, `gray-*` 계열을 X 토큰으로 교체 (`gray-200→x-border`, `gray-500→x-secondary`, `gray-400→x-muted` 등).
- 버튼류는 X 관용구: 아이콘 버튼 = `rounded-full hover:bg-x-hover`(이미 Column 헤더에 부분 적용), 텍스트 버튼 = rounded-full 필.
- Column 정렬 탭: 현재 underline 방식 → X 탭 스타일(선택 = 볼드 + 하단 4px rounded 파란 인디케이터, hover `bg-x-hover`).
- Sidebar: 배경 흰색, 활성 네비 항목 = 볼드(X 네비 동작), hover `bg-x-hover` rounded-full 유지.

### 5. 데이터 흐름 / 에러 처리

데이터 모델·API 변경 없음. 순수 프레젠테이션 + `tokenizeTweetText` 순수 함수 추가만. 링크는 전부 `target="_blank" rel="noopener"`. `tweetUrl`/`authorHandle`이 비어 있는 레코드는 링크 없이 텍스트로 폴백.

### 6. 테스트 / 검증

- `src/lib/tweetText.test.ts`: 멘션/해시태그(한·일·영)/URL/혼합/경계 케이스(문장부호 인접, 일본어 조사 뒤 태그 등) 단위 테스트.
- 기존 테스트 41개 전부 green 유지 (UI 변경이라 영향 없어야 정상).
- `npm run build` 통과.
- dev 서버 + 브라우저로 실화면 검증: 덱/보관함/설정 모달/사이드바, 시스템 다크모드 상태에서도 라이트 고정 확인.

## 주의사항

- 워킹 트리에 커밋 안 된 exa 리서치 기능 파일들이 있음(`src/lib/exa.ts`, `research.ts` 등, 이전 세션 진행분). 이번 작업 커밋에 섞지 않는다(커밋 시 이번 작업 파일만 명시적으로 stage). `research/page.tsx`·`suggest.ts`·`package.json`은 리서치 작업으로 이미 수정돼 있으므로 이번 작업에서 건드리지 않는다.
