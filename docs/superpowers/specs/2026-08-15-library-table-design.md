# 보관함 표 보기 (2026-08-15)

## 의도 / 목적

보관함은 카드(열 분배)로 "다시 발견"하는 화면인데, 저장물이 쌓이면 **데이터를 나란히 놓고 비교·확인**(지표·계정 규모·누가 저장했고 어떤 코멘트가 달렸는지)하는 작업이 카드로는 느리다. 콘텐츠 생성의 표 보기(DraftTable)처럼 훑기 전용 표를 추가한다. 표는 트리아지·확인용이고, 정독·조작(코멘트·번역·팀에서 빼기)은 행 클릭으로 여는 카드 팝업에서 한다.

## 참고 패턴과 재사용 경계

- **DraftTable(콘텐츠 생성) 패턴을 따른다**: 페이지가 정렬 상태를 소유, 표 컴포넌트는 받은 순서를 그대로 그림, 행 전체 클릭 = 카드 팝업(셀 안 링크·버튼과 드래그 선택은 예외), 행 tabIndex+Enter/Space 키보드 접근.
- **덱 표(TweetTable/tableColumns/tweet-table API)는 건드리지 않는다**: TableRow(컬럼명 결합)·서버 페이지네이션에 결합돼 있어 재사용하지 않는다. 공유하는 건 유틸(formatFull, datetime, tweetPermalink)과 표기 규칙뿐.
- **데이터는 기존 `/api/library` 전량 fetch를 그대로 사용** — 새 API·스키마 변경 0. 팀 보관함 규모(수십~수백)라 클라이언트 정렬로 충분하고, 전량이 이미 메모리에 있어 generate의 "정렬 후 절단" 문제도 없다.
- **행 클릭 팝업 = CandidateCard를 모달 셸에 그대로 얹는다** (DraftCard 단일 표면 원칙과 동일): 코멘트 달기·수정, 팀에서 빼기(실행취소 포함), 번역, 초안 링크가 표 모드에서도 전부 동일하게 동작. 별도 표 전용 상세 UI를 만들지 않는다.

## 화면

### 뷰 토글

- 헤더의 `트윗 | 섭외 후보` 옆이 아니라, **트윗 뷰 내부 필터 줄에 `카드 | 표` 토글 칩** 추가(멤버 칩과 분리, 기존 chip 스타일). 섭외 후보 뷰와는 무관.
- 보기 모드는 덱과 같은 방식으로 **URL `?view=table`** 에 기록(router.replace) — 새로고침·공유에도 유지. 기본은 카드.

### 표 컬럼 (왼→오)

| 컬럼 | 값 | 정렬 |
|---|---|---|
| 본문 | text 첫 줄, truncate(max-w), title 툴팁=전문 | — |
| 계정 | @handle (authorName은 툴팁) | — |
| 팔로워 | 콤마 원값, 없으면 '–' | ✓ |
| 게시일 | kstDate | ✓ |
| 조회수·좋아요·리포스트·북마크·답글 | 콤마 원값, 없으면 '–' (표 규칙: 축약 금지) | ✓ 각각 |
| 저장한 사람 | 멤버 이름 나열(코멘트 단 사람들), 없으면 담은 사람 이름 | — |
| 코멘트 | `N · 최신 메모 첫 줄` truncate (메모 전무 시 '–') | 개수 ✓ |
| 담은 시각 | addedAt, kstShort | ✓ (기본, desc) |
| 링크 | 원문 새 탭 링크 (셀 클릭은 행 클릭으로 안 번짐) | — |

- 숫자 칸은 우측 정렬 + tabular-nums. 정렬 헤더는 DraftTable과 같은 토글(같은 키 재클릭=방향 반전, 새 키=desc부터). null 값은 정렬 시 항상 뒤로.
- 멤버 필터 칩은 카드·표 공통으로 적용(같은 `groups` 배열 사용).
- '전체 번역' 버튼은 표 모드에서 숨긴다 — 표에 번역 표시 지점이 없어 거짓 어포던스가 된다. 번역은 팝업(카드)에서 카드와 동일하게.
- 건수 표기(`N건`)·빈 상태·에러/재시도 분기는 카드와 공유(기존 그대로).

### 행 클릭 팝업

- 기존 모달 패턴(fixed inset-0 bg-black/40, 배경 클릭·Esc로 닫기) 셸에 CandidateCard 렌더. 페이지의 useTranslations·requestRemoveTeam·load를 그대로 내려준다.
- 팝업에서 "팀에서 빼기"를 누르면 팝업을 닫고 기존 실행취소 토스트 흐름을 탄다.
- 닫을 때 포커스를 눌렀던 행으로 복귀(TweetTableView와 같은 data-attr + rAF 패턴).

## 파일 구조

- `src/lib/libraryTable.ts` (신규): 컬럼 정의(`LIBRARY_TABLE_COLUMNS`), 정렬(`sortLibraryEntries(entries, sort)`), 셀 파생값(코멘트 요약 등) — 순수 함수, **단위테스트 대상**.
- `src/lib/libraryTable.test.ts` (신규): 정렬(각 키·방향·null 뒤로)·코멘트 요약·저장한 사람 폴백 테스트.
- `src/components/LibraryTable.tsx` (신규): 표 렌더(DraftTable 골격 이식, 선택 체크박스는 없음).
- `src/components/LibraryCardModal.tsx` (신규): 모달 셸 + CandidateCard.
- `src/app/w/[wsId]/library/page.tsx` (수정): view 파생(useSearchParams)·정렬 상태·표 분기·팝업 상태 배선.

## v1 제외 (백로그)

- CSV 내보내기, 다중 선택·일괄 처리, 필터 패널(축 조건) — 목적이 '확인'이고 규모가 작아 아직 불요.
- 컬럼 폭 드래그 조절 — 덱 표의 기능이지만 v1은 고정 폭.

## 엣지 케이스

- candidates가 빈 항목(담기만 된 카드): 저장한 사람 = addedBy 이름, 코멘트 '–', 담은 시각 = addedAt.
- 팝업이 열린 채 목록 갱신으로 해당 트윗이 사라지면(팀에서 빼기 등) 팝업을 닫는다.
- pendingRemove로 숨긴 행은 표에도 안 보인다(같은 groups 사용이라 자동).

## 검증

- `libraryTable.test.ts`를 기존 test 러너로(단일 파일은 tsx로 수초). `npm run lint`(기준선 24) + `npm run build`.
- koo 화면 QA: 토글·정렬 각 키·행 클릭 팝업에서 코멘트/빼기/번역 동작·멤버 필터 공통 적용·카드 보기 회귀 없음.
