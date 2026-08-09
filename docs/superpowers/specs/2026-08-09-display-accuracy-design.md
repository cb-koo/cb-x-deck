# 표시 정확성 묶음 설계 — 사용량 전역 이전 · 삭제된 wsId 안내 · 태그 0건 제거

날짜: 2026-08-09
상태: 설계 사용자 승인됨 (쉬운 설명 버전으로 확인)

## 배경 · 목적

화면이 사실과 다르게 말하는 3곳을 고친다 (AGENTS.md 원칙 4 — 라벨과 값은 항상 일치).

1. 사용량 페이지: URL이 `/w/{wsId}/usage`라 워크스페이스별 수치로 오독되지만 실제는 전역 합계다.
2. 삭제된/잘못된 워크스페이스 링크: 정상적인 "컬럼이 없습니다" 빈 화면으로 위장되고, 사이드바 select는 엉뚱한 첫 워크스페이스를 표시한다.
3. 태그 목록 API: 다른 워크스페이스에서만 쓰인 태그가 0건으로 섞여 반환된다 (현재 UI 소비자 없음 — 선제 정리).

## 확정된 사실 (탐색 결과)

- `api_usage`에 workspace_id가 없고 조회 함수(`rawAggregate`/`dailyAggregate`)에 워크스페이스 필터가 없다. `usage/page.tsx`의 wsId는 기간 탭 링크 접두사로만 쓰인다. → 워크스페이스별 사용량은 불가능하며, 전역 페이지로 옮기는 것이 정직한 표시다.
- wsId 검증은 어디에도 없다: `/w/[wsId]/layout.tsx`는 검증 없이 `cbx-last-ws`에 저장하고, `GlobalShell`은 저장값을 목록 대조 없이 사용하며, `listColumns`는 non-UUID 입력 시 postgres 22P02 → 500.
- `isUuidLike` 가드는 `tweetStore.ts` 파일-로컬로만 존재.
- `listAllTags`(candidateStore.ts:119-128)는 tag를 드라이빙 테이블로 left join하며 워크스페이스 조건이 ON절에만 있어 0건 태그가 전부 반환된다. 호출자는 `GET /api/tags`뿐이고 이를 쓰는 UI는 없다.

## A. 사용량 페이지 전역 이전

- `src/app/w/[wsId]/usage/` 6개 파일(page + UsageHeadline/ActualCostPanel/FeatureBreakdown/UsageBar/UsageDetailTables)을 `src/app/usage/`로 이동.
- `src/app/usage/layout.tsx` 신설 — `clients/layout.tsx`와 동일한 GlobalShell 3줄 패턴.
- `page.tsx`: `params`(wsId) 시그니처 제거, 기간 탭 링크를 `/usage?period=…`로.
- **이중 스크롤 수정**: GlobalShell 콘텐츠 래퍼가 이미 `overflow-y-auto`이므로 page 루트의 `h-screen overflow-y-auto`를 제거(`p-8`은 유지).
- **정직한 라벨**: 페이지 제목 아래 캡션 추가 — "모든 워크스페이스 합산 수치입니다." (기대 설정 — 원칙 2)
- 사이드바: 사용량 링크를 하단 블록에서 `/usage`로 변경 (href + active 판정). 라벨 "API 사용량" 유지.
- **옛 URL 보호**: `src/app/w/[wsId]/usage/page.tsx`를 `redirect('/usage')` 하는 최소 서버 컴포넌트로 남긴다(쿼리 `period`는 보존하지 않아도 됨 — 기본 탭으로 충분).

## B. 삭제된/잘못된 wsId — 세 겹 검증

### B-1. `/w/[wsId]/layout.tsx` 게이트
- 마운트 시 `GET /api/workspaces`로 목록을 받아 wsId 존재를 검증한다.
- **존재하면**: 그때에만 `cbx-last-ws`에 저장(현재는 무검증 저장), children 렌더.
- **없으면**: children 대신 전용 안내 화면 — "이 워크스페이스를 찾을 수 없습니다. 삭제됐을 수 있어요." + `워크스페이스 목록으로` 버튼(`/workspaces`). 이때 `cbx-last-ws`가 이 wsId와 같으면 제거. 사이드바는 렌더하지 않는다(죽은 wsId 링크 방지).
- **검증 중**(목록 로딩): 짧은 "확인 중…" 상태. 목록 조회 실패 시: 안내 + 다시 시도 (빈 상태로 위장 금지).
- 검증 통과 전에는 children을 렌더하지 않는다 → 하위 페이지의 죽은 wsId API 호출·"컬럼이 없습니다" 위장이 원천 차단된다.

### B-2. `GlobalShell` 복원 검증
- 현재: 저장값이 있으면 목록 조회 없이 그대로 사용. → 변경: 항상 목록을 조회해 `저장값이 목록에 있으면 그것, 없으면 첫 번째`(루트 `/`의 `page.tsx`와 동일 로직). 0개면 사이드바 없이 children만(기존 동작 유지).

### B-3. API 형식 가드
- `isUuidLike`(+`UUID_RE`)를 `src/lib/uuid.ts`로 승격, `tweetStore.ts`는 그걸 import (동작 불변).
- `GET /api/columns`: workspaceId가 UUID 형식이 아니면 400 (현재 postgres 22P02 → 500).

## C. 태그 0건 제거

- `listAllTags` 쿼리에 `having count(distinct c.tweet_id) > 0` 추가 — 해당 워크스페이스에서 실제 쓰인 태그만 반환.
- 태그 부착은 이름 upsert(`addTag`) 방식이라 전역 목록 의존이 없다 — 숨겨도 동작 손실 없음 (탐색으로 확인).
- 테스트: 다른 워크스페이스 전용 태그가 목록에 안 나오는 케이스 추가.

## 범위 제외

- 사용량의 워크스페이스별 집계(스키마에 개념 없음 — 별도 기획 사안), `?view=table` 전환 보존(전환·복귀 묶음), `/w/[wsId]` 하위 각 페이지의 개별 검증(레이아웃 게이트가 원천 차단하므로 불필요).

## 테스트

- `candidateStore.test.ts`: 타 워크스페이스 전용 태그 미노출.
- `uuid.ts` 승격: tweetStore 기존 테스트가 회귀 검증 역할. columns 라우트 400은 하네스 부재 관례상 코드 리뷰로.
- 화면 동작(A 이전·B 안내 화면): 배포 후 사용자 확인 항목으로 전달.

## UX 원칙 체크

1. 사용자 언어 — "이 워크스페이스를 찾을 수 없습니다. 삭제됐을 수 있어요." ✓
2. 기대 설정 — 사용량 캡션 "모든 워크스페이스 합산 수치입니다." ✓
3. 판단 서술 — 안내 화면이 원인 추정(삭제)과 다음 행동(목록으로)을 제시 ✓
4. 라벨=값 — 세 항목 모두 이 원칙 위반의 해소가 목적 ✓
5. 기술 값 노출 최소화 — UUID 등 내부 값 노출 없음 ✓
6. 비용 유발 액션 — 없음 ✓
